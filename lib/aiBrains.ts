import { VERDICTS, type Verdict } from "./eventTypes";
import { getOpenRouterKey } from "./keys";

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

// Diagnostics only: why a model call produced no verdict. Logs the model
// name, a failure kind and a short fixed detail - never keys or bodies.
type FailureKind =
  | `http_${number}`
  | "timeout"
  | "network"
  | "no_text_block"
  | "bad_json"
  | "bad_verdict"
  | "cooldown"
  | "not_configured";

function warnBrain(model: string, kind: FailureKind, detail: string) {
  console.warn(`[brain] ${model || "(unset)"} ${kind} ${detail.slice(0, 80)}`);
}

// Same checks as parseVerdict, used only to name the failure.
function verdictFailureKind(text: string): "bad_json" | "bad_verdict" {
  const stripped = text.replace(/```[a-zA-Z]*\s*/g, "").replace(/```/g, "");
  const raw = extractFirstJsonObject(stripped);
  if (!raw) return "bad_json";
  try {
    JSON.parse(raw);
    return "bad_verdict";
  } catch {
    return "bad_json";
  }
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
  if (!model) {
    warnBrain(model, "not_configured", "model name not set");
    return null;
  }
  if (inCooldown(model)) {
    warnBrain(model, "cooldown", "skipped after a recent 404/429");
    return null;
  }

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
      warnBrain(model, `http_${res.status}`, `cooling down for ${COOLDOWN_MS / 1000}s`);
      return null;
    }
    if (!res.ok) {
      warnBrain(model, `http_${res.status}`, "request failed");
      return null;
    }

    let data: { content?: unknown };
    try {
      data = (await res.json()) as { content?: unknown };
    } catch {
      warnBrain(model, "bad_json", "response body was not JSON");
      return null;
    }
    if (!Array.isArray(data.content)) {
      warnBrain(model, "no_text_block", "response had no content array");
      return null;
    }
    // Replies may start with a "thinking" block - use the first text block.
    const textBlock = data.content.find(
      (b): b is { type: "text"; text: string } =>
        !!b &&
        typeof b === "object" &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    );
    if (!textBlock) {
      warnBrain(model, "no_text_block", "no text block in content");
      return null;
    }

    const parsed = parseVerdict(textBlock.text);
    if (!parsed) {
      const kind = verdictFailureKind(textBlock.text);
      warnBrain(
        model,
        kind,
        kind === "bad_json" ? "no parseable JSON object in reply" : "verdict missing or not CLEAR|REVIEW|FLAG",
      );
      return null;
    }
    return { ...parsed, model };
  } catch (err) {
    if (controller.signal.aborted) warnBrain(model, "timeout", `no reply within ${timeoutMs}ms`);
    else warnBrain(model, "network", err instanceof Error ? err.name : "fetch failed");
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
  // Diagnostics only: one summary line per run.
  const done = (result: BrainVerdict, outcome: string): BrainVerdict => {
    console.info(`[brain] run ${ctx.symbol} ${outcome} -> ${result.verdict}`);
    return result;
  };
  try {
    const apiKey = await getOpenRouterKey();
    if (!apiKey) {
      warnBrain("openrouter", "not_configured", "no OpenRouter key in cookie or env");
      return done(unavailable, "no_key");
    }

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
        return done(
          {
            verdict: primary.verdict,
            reason: `${withoutTrailingPeriod(primary.reason)} (verified by two models: ${primary.model} + ${secondary.model})`,
          },
          "agree",
        );
      }
      return done({ verdict: REVIEW, reason: DISAGREE_REASON }, "disagree");
    }

    // Exactly one brain answered - the last-resort model substitutes for the other.
    const single = primary ?? secondary;
    if (single) {
      const failedModel = (primary ? cfg.secondary : cfg.primary) || "second model";
      const substitute =
        cfg.lastResort !== single.model ? await call(cfg.lastResort) : null;
      if (substitute) {
        if (substitute.verdict === single.verdict) {
          return done(
            {
              verdict: single.verdict,
              reason: `${withoutTrailingPeriod(single.reason)} (verified by two models: ${single.model} + ${substitute.model})`,
            },
            "substitute_agree",
          );
        }
        return done({ verdict: REVIEW, reason: DISAGREE_REASON }, "substitute_disagree");
      }
      return done(
        {
          verdict: single.verdict,
          reason: `${withoutTrailingPeriod(single.reason)} (single model: ${single.model}; ${failedModel} unavailable)`,
        },
        "single",
      );
    }

    // Neither brain answered - last-resort model alone.
    const fallback = await call(cfg.lastResort);
    if (fallback) {
      return done(
        {
          verdict: fallback.verdict,
          reason: `${withoutTrailingPeriod(fallback.reason)} (single fallback model)`,
        },
        "fallback",
      );
    }

    return done(unavailable, "unavailable");
  } catch {
    return done(unavailable, "error");
  }
}
