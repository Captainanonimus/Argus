import { cookies } from "next/headers";
import { VERDICTS, type Verdict } from "./eventTypes";

// Dual-brain check: two independent models judge an ambiguous market
// situation; a third "last resort" model substitutes for a failed brain.
// All model names come from the environment.

const [, REVIEW] = VERDICTS;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/messages";
const SYSTEM_PROMPT =
  "You are a market surveillance analyst. Reply with ONLY a JSON object, no other text.";
const DEFAULT_LAST_RESORT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const DEFAULT_TIMEOUT_MS = 20000;
const COOLDOWN_MS = 60_000;

const DISAGREE_REASON =
  "Primary and secondary models disagreed - routed to human review.";
const UNAVAILABLE_REASON =
  "surveillance models unavailable - routed to manual review.";

export type BrainEvent = {
  side: string;
  eventType: string;
  price: number;
  size: number;
  accountId: string;
  createdAt: Date;
};

export type BrainContext = {
  symbol: string;
  counts: { placed: number; canceled: number; filled: number; total: number };
  orderToTradeRatio: number;
  zScore: number;
  recentEvents: BrainEvent[]; // last 10, oldest first
};

export type BrainVerdict = { verdict: Verdict; reason: string };

type BrainResult = (BrainVerdict & { model: string }) | null;

function config() {
  const timeout = Number(process.env.AI_TIMEOUT_MS);
  return {
    primary: process.env.AI_PRIMARY_MODEL?.trim() || "",
    secondary: process.env.AI_SECONDARY_MODEL?.trim() || "",
    lastResort:
      process.env.AI_LAST_RESORT_MODEL?.trim() || DEFAULT_LAST_RESORT_MODEL,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_TIMEOUT_MS,
  };
}

// Module-level cooldown (best effort: only shared within one warm instance).
// Failed requests still count against the free daily cap, so a model that
// answered 404/429 is skipped for a minute.
const cooldownUntil = new Map<string, number>();

function inCooldown(model: string): boolean {
  const until = cooldownUntil.get(model);
  if (until === undefined) return false;
  if (Date.now() >= until) {
    cooldownUntil.delete(model);
    return false;
  }
  return true;
}

async function getApiKey(): Promise<string | null> {
  try {
    // Works whether cookies() is sync (Next 14) or async (Next 15+).
    const store = await Promise.resolve(cookies());
    const fromCookie = store.get("openrouter_key")?.value?.trim();
    if (fromCookie) return fromCookie;
  } catch {
    // Outside a request scope - fall through to the environment.
  }
  return process.env.OPENROUTER_API_KEY?.trim() || null;
}

function buildUserPrompt(ctx: BrainContext): string {
  const events = ctx.recentEvents
    .map(
      (e) =>
        `${e.createdAt.toISOString()} ${e.eventType} ${e.side} size=${e.size} price=${e.price} account=${e.accountId}`,
    )
    .join("\n");
  return [
    `Symbol: ${ctx.symbol}`,
    `Last 60 seconds: ${ctx.counts.total} events (${ctx.counts.placed} placed, ${ctx.counts.canceled} canceled, ${ctx.counts.filled} filled)`,
    `Order-to-trade ratio (60s): ${ctx.orderToTradeRatio.toFixed(2)}`,
    `Order-book imbalance z-score (5-second buckets over 5 minutes): ${ctx.zScore.toFixed(2)}`,
    `Last ${ctx.recentEvents.length} events (oldest first):`,
    events || "(none)",
    "",
    'Return {"verdict":"CLEAR|REVIEW|FLAG","reason":"one sentence"}',
  ].join("\n");
}

// Returns the first balanced {...} object in the text, ignoring braces
// that appear inside JSON strings.
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseVerdict(text: string): BrainVerdict | null {
  const stripped = text.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "");
  const raw = extractFirstJsonObject(stripped);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as { verdict?: unknown; reason?: unknown };
    const verdict =
      typeof obj.verdict === "string" ? obj.verdict.trim().toUpperCase() : "";
    if (!(VERDICTS as readonly string[]).includes(verdict)) return null;
    const reason =
      typeof obj.reason === "string" && obj.reason.trim()
        ? obj.reason.trim()
        : "No reason given.";
    return { verdict: verdict as Verdict, reason };
  } catch {
    return null;
  }
}

async function callBrain(
  model: string,
  apiKey: string,
  prompt: string,
  timeoutMs: number,
): Promise<BrainResult> {
  if (!model || inCooldown(model)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (res.status === 404 || res.status === 429) {
      cooldownUntil.set(model, Date.now() + COOLDOWN_MS);
      return null;
    }
    if (!res.ok) return null;

    const data = (await res.json()) as { content?: unknown };
    if (!Array.isArray(data.content)) return null;
    // Replies may start with a "thinking" block - use the first text block.
    const textBlock = data.content.find(
      (b): b is { type: "text"; text: string } =>
        !!b &&
        typeof b === "object" &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    );
    if (!textBlock) return null;

    const parsed = parseVerdict(textBlock.text);
    return parsed ? { ...parsed, model } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function withoutTrailingPeriod(reason: string): string {
  return reason.replace(/\.\s*$/, "");
}

export async function runDualBrainCheck(ctx: BrainContext): Promise<BrainVerdict> {
  const unavailable: BrainVerdict = { verdict: REVIEW, reason: UNAVAILABLE_REASON };
  try {
    const apiKey = await getApiKey();
    if (!apiKey) return unavailable;

    const cfg = config();
    const prompt = buildUserPrompt(ctx);
    const call = (model: string) => callBrain(model, apiKey, prompt, cfg.timeoutMs);

    const [primarySettled, secondarySettled] = await Promise.allSettled([
      call(cfg.primary),
      call(cfg.secondary),
    ]);
    const primary = primarySettled.status === "fulfilled" ? primarySettled.value : null;
    const secondary =
      secondarySettled.status === "fulfilled" ? secondarySettled.value : null;

    // Both brains answered.
    if (primary && secondary) {
      if (primary.verdict === secondary.verdict) {
        return {
          verdict: primary.verdict,
          reason: `${withoutTrailingPeriod(primary.reason)} (verified by two models: ${primary.model} + ${secondary.model})`,
        };
      }
      return { verdict: REVIEW, reason: DISAGREE_REASON };
    }

    // Exactly one brain answered - the last-resort model substitutes for the other.
    const single = primary ?? secondary;
    if (single) {
      const failedModel = (primary ? cfg.secondary : cfg.primary) || "second model";
      const substitute =
        cfg.lastResort !== single.model ? await call(cfg.lastResort) : null;
      if (substitute) {
        if (substitute.verdict === single.verdict) {
          return {
            verdict: single.verdict,
            reason: `${withoutTrailingPeriod(single.reason)} (verified by two models: ${single.model} + ${substitute.model})`,
          };
        }
        return { verdict: REVIEW, reason: DISAGREE_REASON };
      }
      return {
        verdict: single.verdict,
        reason: `${withoutTrailingPeriod(single.reason)} (single model: ${single.model}; ${failedModel} unavailable)`,
      };
    }

    // Neither brain answered - last-resort model alone.
    const fallback = await call(cfg.lastResort);
    if (fallback) {
      return {
        verdict: fallback.verdict,
        reason: `${withoutTrailingPeriod(fallback.reason)} (single fallback model)`,
      };
    }

    return unavailable;
  } catch {
    return unavailable;
  }
}
