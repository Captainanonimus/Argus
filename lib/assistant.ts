import { prisma } from "./prisma";
import { getOpenRouterKey } from "./keys";
import { ALERT_EVENT_SELECT, ALERT_ORDER } from "./alertQuery";
import { explainMetric, RULES, THRESHOLDS } from "./rules";
import { fetchPages, search, type WebErrorKind } from "./tinyfish";

// Server side of the assistant: grounded context from the database, optional
// web sources from TinyFish, and one call to a free model through OpenRouter
// (same request shape and failure handling as lib/aiBrains.ts).

const OPENROUTER_URL = "https://openrouter.ai/api/v1/messages";
const DEFAULT_LAST_RESORT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
const DEFAULT_TIMEOUT_MS = 25_000;
const COOLDOWN_MS = 60_000;
const MAX_TOKENS = 1500;
const CONTEXT_MAX = 14_000;

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type Source = { n: number; title: string; url: string; snippet: string; site: string };
export type Notice = { code: string; message: string };

export const SYSTEM_PROMPT = [
  "You are the Argus market-surveillance assistant. You help compliance analysts understand alerts raised by the Argus surveillance engine.",
  "Rules:",
  "- Answer from the ARGUS DATA and WEB SOURCES provided below. Do not invent figures, prices, counts, account ids or dates. If a number is not in the data, say it is not available.",
  "- Keep Argus data and web sources clearly separate. When you use Argus data, say so (for example 'In Argus data, ...'). When you use a web source, cite it inline as [1], [2] matching the numbered WEB SOURCES. Never cite a number that is not listed.",
  "- If the information needed to answer is missing, say what is missing and how the analyst could get it (for example, run a scenario in the simulator or open the case).",
  "- Alerts are statistical signals for human review, not findings of misconduct. Do not state or imply that anyone broke the law.",
  "- Do not give legal advice. For legal or regulatory obligations, suggest consulting the firm's compliance or legal team.",
  "- Be concise and practical. Use short paragraphs or bullet lists. Plain text and simple markdown only, no HTML.",
].join("\n");

// --- Context from the database --------------------------------------------

function iso(d: Date) {
  return d.toISOString();
}

function ruleSummary(): string {
  const t = THRESHOLDS;
  return [
    "Surveillance rules (from the Argus engine):",
    ...RULES.map((r) => `- ${r.name}: ${r.threshold}`),
    `- Alerts of the same type on the same symbol are saved at most once per ${t.dedupeS}s.`,
    "- Verdicts: CLEAR (nothing fired), REVIEW (needs an analyst), FLAG (rule threshold crossed).",
    "- Alert statuses: open, investigating, escalated, dismissed.",
  ].join("\n");
}

async function generalContext(symbol: string | null): Promise<string> {
  const eventWhere = symbol ? { symbol } : {};
  const alertWhere = symbol ? { orderEvent: { symbol } } : {};
  const [byType, totalAlerts, byVerdict, byStatus, recent, symbols] = await Promise.all([
    prisma.orderEvent.groupBy({ by: ["eventType"], where: eventWhere, _count: { _all: true } }),
    prisma.alert.count({ where: alertWhere }),
    prisma.alert.groupBy({ by: ["verdict"], where: alertWhere, _count: { _all: true } }),
    prisma.alert.groupBy({ by: ["status"], where: alertWhere, _count: { _all: true } }),
    prisma.alert.findMany({
      where: alertWhere,
      orderBy: ALERT_ORDER,
      take: 15,
      include: { orderEvent: { select: ALERT_EVENT_SELECT } },
    }),
    prisma.orderEvent.groupBy({
      by: ["symbol"],
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { symbol: "asc" },
      take: 50,
    }),
  ]);

  // Alerts per symbol over the most recent 500 alerts.
  const sample = await prisma.alert.findMany({
    where: alertWhere,
    orderBy: ALERT_ORDER,
    take: 500,
    select: { verdict: true, alertType: true, orderEvent: { select: { symbol: true } } },
  });
  const perSymbol = new Map<string, { total: number; flags: number }>();
  for (const a of sample) {
    const s = perSymbol.get(a.orderEvent.symbol) ?? { total: 0, flags: 0 };
    s.total++;
    if (a.verdict === "FLAG") s.flags++;
    perSymbol.set(a.orderEvent.symbol, s);
  }

  const events = byType.reduce((n, g) => n + g._count._all, 0);
  const lines = [
    `Scope: ${symbol ? `symbol ${symbol}` : "all symbols"}. Data as of ${iso(new Date())}.`,
    `Events: ${events} total (${byType.map((g) => `${g.eventType} ${g._count._all}`).join(", ") || "none"}).`,
    `Alerts: ${totalAlerts} total. By verdict: ${byVerdict.map((g) => `${g.verdict} ${g._count._all}`).join(", ") || "none"}. By status: ${byStatus.map((g) => `${g.status} ${g._count._all}`).join(", ") || "none"}.`,
    `Symbols (${symbols.length}): ${symbols.map((s) => `${s.symbol} (${s._count._all} events, last ${s._max.createdAt ? iso(s._max.createdAt) : "n/a"})`).join("; ") || "none"}.`,
    `Alerts per symbol (latest ${sample.length} alerts): ${
      Array.from(perSymbol.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([s, c]) => `${s} ${c.total} (${c.flags} FLAG)`)
        .join("; ") || "none"
    }.`,
    "",
    `Most recent alerts (newest first, up to 15):`,
    ...(recent.length
      ? recent.map(
          (a) =>
            `- id ${a.id} | ${iso(a.createdAt)} | ${a.orderEvent.symbol} | ${a.alertType} | ${a.verdict} | status ${a.status} | metric ${a.metricValue.toFixed(2)} | ${a.reason}`,
        )
      : ["- none"]),
  ];
  return lines.join("\n");
}

async function caseContext(alertId: string): Promise<string | null> {
  const alert = await prisma.alert.findUnique({
    where: { id: alertId },
    include: { orderEvent: { select: ALERT_EVENT_SELECT } },
  });
  if (!alert) return null;
  const e = alert.orderEvent;
  const t = e.createdAt.getTime();
  const timeline = await prisma.orderEvent.findMany({
    where: { symbol: e.symbol, createdAt: { gte: new Date(t - 30_000), lte: new Date(t + 10_000) } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 300,
    select: { ...ALERT_EVENT_SELECT, alerts: { select: { alertType: true, verdict: true } } },
  });

  const counts = { place: 0, cancel: 0, fill: 0 } as Record<string, number>;
  const byAccount = new Map<string, number>();
  for (const ev of timeline) {
    counts[ev.eventType] = (counts[ev.eventType] ?? 0) + 1;
    byAccount.set(ev.accountId, (byAccount.get(ev.accountId) ?? 0) + 1);
  }
  const shown = timeline.length > 60 ? timeline.slice(-60) : timeline;

  return [
    `CASE: alert ${alert.id}`,
    `Type: ${alert.alertType}. Verdict: ${alert.verdict}. Status: ${alert.status}. Metric value: ${alert.metricValue}.`,
    `Raised: ${iso(alert.createdAt)}. Last updated: ${iso(alert.updatedAt)}.`,
    `Engine reason: ${alert.reason}`,
    `Plain-language reading: ${explainMetric(alert.alertType, alert.metricValue, e.symbol)}`,
    `Analyst note: ${alert.note.trim() ? alert.note.trim() : "(none)"}`,
    `Triggering event: ${e.id} | ${iso(e.createdAt)} | ${e.symbol} | ${e.eventType} ${e.side} ${e.size} @ ${e.price} | account ${e.accountId}`,
    "",
    `Timeline on ${e.symbol} from 30s before to 10s after the trigger: ${timeline.length} events (place ${counts.place}, cancel ${counts.cancel}, fill ${counts.fill}).`,
    `Events per account: ${Array.from(byAccount.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([a, n]) => `${a} ${n}`)
      .join(", ")}.`,
    `${timeline.length > shown.length ? `Last ${shown.length} events` : "Events"} (oldest first; offset in ms from the trigger):`,
    ...shown.map(
      (ev) =>
        `- ${ev.createdAt.getTime() - t >= 0 ? "+" : ""}${ev.createdAt.getTime() - t}ms ${ev.eventType} ${ev.side} ${ev.size} @ ${ev.price} acct ${ev.accountId}${ev.id === e.id ? " [TRIGGER]" : ""}${ev.alerts.length ? ` [alerts: ${ev.alerts.map((x) => `${x.alertType} ${x.verdict}`).join(", ")}]` : ""}`,
    ),
  ].join("\n");
}

export async function buildArgusContext(opts: {
  alertId: string | null;
  symbol: string | null;
}): Promise<{ text: string; notices: Notice[]; caseFound: boolean | null }> {
  const notices: Notice[] = [];
  const parts: string[] = [ruleSummary()];
  let caseFound: boolean | null = null;
  try {
    if (opts.alertId) {
      const c = await caseContext(opts.alertId);
      caseFound = !!c;
      if (c) parts.push(c);
      else notices.push({ code: "alert_not_found", message: "That alert was not found, so general Argus data was used instead." });
    }
    parts.push(await generalContext(opts.symbol));
  } catch {
    console.warn("[assistant] context database_unavailable");
    notices.push({
      code: "db_unavailable",
      message: "The Argus database could not be read, so the answer has no Argus data.",
    });
    parts.push("Argus data is unavailable right now (database error).");
  }
  let text = parts.join("\n\n");
  if (text.length > CONTEXT_MAX) text = `${text.slice(0, CONTEXT_MAX)}\n[context truncated]`;
  return { text, notices, caseFound };
}

// --- Web sources -----------------------------------------------------------

const WEB_NOTICE: Partial<Record<WebErrorKind, string>> = {
  no_key: "Web search is on, but no TinyFish key is saved. Add one to include web sources.",
};

export function webQueryFrom(message: string): string {
  return message
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[`*_#>[\]()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

export async function gatherWebSources(query: string): Promise<{
  sources: Source[];
  text: string;
  notices: Notice[];
}> {
  const notices: Notice[] = [];
  if (!query) {
    return { sources: [], text: "", notices: [{ code: "web_empty_query", message: "There was nothing to search for." }] };
  }
  const found = await search(query, 3);
  if (!found.ok) {
    const code = found.error.kind === "no_key" ? "no_tinyfish_key" : `web_${found.error.kind}`;
    notices.push({ code, message: WEB_NOTICE[found.error.kind] ?? `Web search failed: ${found.error.message}` });
    return { sources: [], text: "", notices };
  }

  const hits = found.value;
  const pages = await fetchPages(hits.slice(0, 2).map((h) => h.url));
  if (!pages.ok) {
    notices.push({ code: `web_fetch_${pages.error.kind}`, message: "Result pages could not be read, so only search snippets were used." });
  }

  const sources: Source[] = hits.map((h, i) => ({
    n: i + 1,
    title: h.title,
    url: h.url,
    snippet: h.snippet,
    site: h.site,
  }));
  const blocks = hits.map((h, i) => {
    const page = pages.ok
      ? pages.value.find((p) => p.requestedUrl === h.url || p.url === h.url)
      : undefined;
    const body = page ? `Page text${page.truncated ? " (first 4000 characters)" : ""}:\n${page.text}` : `Snippet: ${h.snippet || "(none)"}`;
    return `[${i + 1}] ${h.title}\nURL: ${h.url}\n${body}`;
  });
  return { sources, text: blocks.join("\n\n---\n\n"), notices };
}

// --- Model call ------------------------------------------------------------

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

export function chatModels(): string[] {
  const chat = process.env.AI_CHAT_MODEL?.trim();
  const primary = process.env.AI_PRIMARY_MODEL?.trim();
  const last = process.env.AI_LAST_RESORT_MODEL?.trim() || DEFAULT_LAST_RESORT_MODEL;
  return Array.from(new Set([chat || primary, last].filter((m): m is string => !!m)));
}

function timeoutMs(): number {
  const t = Number(process.env.AI_TIMEOUT_MS);
  return Number.isFinite(t) && t > 0 ? Math.max(t, DEFAULT_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
}

// Some free models put their reasoning inline; keep only the answer.
function cleanReply(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?<\/think>/i, "")
    .trim();
}

type CallOutcome = { ok: true; text: string } | { ok: false; kind: string };

async function callModel(
  model: string,
  apiKey: string,
  system: string,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<CallOutcome> {
  if (inCooldown(model)) return { ok: false, kind: "cooldown" };
  const controller = new AbortController();
  const ms = timeoutMs();
  const timer = setTimeout(() => controller.abort(), ms);
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort);
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: MAX_TOKENS, system, messages }),
      signal: controller.signal,
      cache: "no-store",
    });
    if (res.status === 404 || res.status === 429) {
      cooldownUntil.set(model, Date.now() + COOLDOWN_MS);
      return { ok: false, kind: `http_${res.status}` };
    }
    if (!res.ok) return { ok: false, kind: `http_${res.status}` };
    let data: { content?: unknown };
    try {
      data = (await res.json()) as { content?: unknown };
    } catch {
      return { ok: false, kind: "bad_json" };
    }
    if (!Array.isArray(data.content)) return { ok: false, kind: "no_text_block" };
    // Replies may start with a "thinking" block - use the first text block.
    const block = data.content.find(
      (b): b is { type: "text"; text: string } =>
        !!b &&
        typeof b === "object" &&
        (b as { type?: unknown }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    );
    if (!block) return { ok: false, kind: "no_text_block" };
    const text = cleanReply(block.text);
    if (!text) return { ok: false, kind: "empty_text" };
    return { ok: true, text };
  } catch {
    return { ok: false, kind: signal.aborted ? "client_abort" : controller.signal.aborted ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

export async function askModel(
  system: string,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<{ reply: string | null; model: string | null; notices: Notice[] }> {
  const notices: Notice[] = [];
  const apiKey = await getOpenRouterKey();
  if (!apiKey) {
    return {
      reply: null,
      model: null,
      notices: [{ code: "no_openrouter_key", message: "No OpenRouter key is saved, so the assistant model cannot answer." }],
    };
  }
  const models = chatModels();
  for (const model of models) {
    if (signal.aborted) break;
    const r = await callModel(model, apiKey, system, messages, signal);
    if (r.ok) return { reply: r.text, model, notices };
    // Model name and failure kind only.
    console.warn(`[assistant] ${model} ${r.kind}`);
    if (r.kind === "http_401" || r.kind === "http_403") {
      notices.push({ code: "openrouter_unauthorized", message: "OpenRouter rejected the key. Check it in Settings." });
      return { reply: null, model: null, notices };
    }
    if (r.kind === "client_abort") break;
  }
  notices.push({
    code: "model_unavailable",
    message: "The assistant models did not answer (busy, rate limited or timed out). Try again in a minute.",
  });
  return { reply: null, model: null, notices };
}

// Used when no model answered: a factual summary built only from the data.
export function fallbackReply(context: string, hasWeb: boolean): string {
  const lines = context.split("\n");
  const pick = (prefix: string) => lines.find((l) => l.startsWith(prefix));
  const parts = [
    "The assistant model is not available right now, so here is the Argus data it would have used:",
    "",
    pick("CASE:") ? `- ${pick("CASE:")}` : null,
    pick("Engine reason:") ? `- ${pick("Engine reason:")}` : null,
    pick("Plain-language reading:") ? `- ${pick("Plain-language reading:")}` : null,
    pick("Events:") ? `- ${pick("Events:")}` : null,
    pick("Alerts:") ? `- ${pick("Alerts:")}` : null,
    pick("Alerts per symbol") ? `- ${pick("Alerts per symbol")}` : null,
    hasWeb ? "- Web sources were found and are listed below." : null,
  ];
  return parts.filter((p): p is string => p !== null).join("\n");
}
