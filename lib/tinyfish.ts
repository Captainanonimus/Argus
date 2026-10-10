import { getTinyFishKey } from "./keys";

// TinyFish web search and page fetch (https://docs.tinyfish.ai).
//   Search: GET  https://api.search.tinyfish.ai?query=...  -> { results: [{ title, url, snippet, ... }] }
//   Fetch:  POST https://api.fetch.tinyfish.ai { urls, format } -> { results: [{ url, title, text }], errors: [] }
// Both authenticate with the X-API-Key header. The key comes from
// getTinyFishKey() and is never logged or returned.

const SEARCH_URL = "https://api.search.tinyfish.ai";
const FETCH_URL = "https://api.fetch.tinyfish.ai";
const TIMEOUT_MS = 15_000;
const MAX_QUERY = 400;
const SNIPPET_MAX = 400;
export const PAGE_TEXT_MAX = 4000;

export type WebErrorKind =
  | "no_key"
  | "unauthorized"
  | "rate_limited"
  | "timeout"
  | "network"
  | "bad_request"
  | "upstream"
  | "bad_response"
  | "empty";

export type WebError = { kind: WebErrorKind; message: string };
export type WebResult<T> = { ok: true; value: T } | { ok: false; error: WebError };

export type SearchHit = { title: string; url: string; snippet: string; site: string };
export type PageText = { requestedUrl: string; url: string; title: string; text: string; truncated: boolean };

const MESSAGES: Record<WebErrorKind, string> = {
  no_key: "No TinyFish key is saved.",
  unauthorized: "TinyFish rejected the key. Check it in Settings.",
  rate_limited: "TinyFish rate limit reached. Try again shortly.",
  timeout: "TinyFish did not answer within 15 seconds.",
  network: "TinyFish could not be reached.",
  bad_request: "TinyFish could not process the request.",
  upstream: "TinyFish returned a server error.",
  bad_response: "TinyFish sent a response Argus could not read.",
  empty: "TinyFish returned no results.",
};

function fail<T>(kind: WebErrorKind, message = MESSAGES[kind]): WebResult<T> {
  return { ok: false, error: { kind, message } };
}

function classifyStatus(status: number): WebErrorKind {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429 || status === 402) return "rate_limited";
  if (status >= 500) return "upstream";
  return "bad_request";
}

function warn(op: string, kind: WebErrorKind) {
  // Operation and failure kind only - never the key, query or body.
  console.warn(`[tinyfish] ${op} ${kind}`);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function clip(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function isHttpUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === "https:" || p.protocol === "http:";
  } catch {
    return false;
  }
}

async function request(
  op: string,
  url: string,
  init: RequestInit,
  key: string,
): Promise<WebResult<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { ...init.headers, "X-API-Key": key, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const kind = classifyStatus(res.status);
      warn(op, kind);
      return fail(kind);
    }
    try {
      return { ok: true, value: await res.json() };
    } catch {
      warn(op, "bad_response");
      return fail("bad_response");
    }
  } catch {
    const kind: WebErrorKind = controller.signal.aborted ? "timeout" : "network";
    warn(op, kind);
    return fail(kind);
  } finally {
    clearTimeout(timer);
  }
}

export async function search(query: string, limit = 5): Promise<WebResult<SearchHit[]>> {
  const key = await getTinyFishKey();
  if (!key) return fail("no_key");
  const q = query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
  if (!q) return fail("bad_request", "The search query is empty.");

  const r = await request("search", `${SEARCH_URL}?${new URLSearchParams({ query: q })}`, { method: "GET" }, key);
  if (!r.ok) return r;

  const results = (r.value as { results?: unknown })?.results;
  if (!Array.isArray(results)) {
    warn("search", "bad_response");
    return fail("bad_response");
  }
  const hits: SearchHit[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const url = str(o.url);
    if (!isHttpUrl(url)) continue;
    hits.push({
      title: clip(str(o.title) || url, 200),
      url,
      snippet: clip(str(o.snippet), SNIPPET_MAX),
      site: str(o.site_name) || new URL(url).hostname,
    });
    if (hits.length >= limit) break;
  }
  if (hits.length === 0) return fail("empty");
  return { ok: true, value: hits };
}

// Fetches up to 10 pages as markdown in one request; page text is cut to
// about 4000 characters. Per-URL failures are skipped.
export async function fetchPages(urls: string[]): Promise<WebResult<PageText[]>> {
  const key = await getTinyFishKey();
  if (!key) return fail("no_key");
  const list = urls.filter(isHttpUrl).slice(0, 10);
  if (list.length === 0) return fail("bad_request", "No valid URL to fetch.");

  const r = await request(
    "fetch",
    FETCH_URL,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: list, format: "markdown" }),
    },
    key,
  );
  if (!r.ok) return r;

  const results = (r.value as { results?: unknown })?.results;
  if (!Array.isArray(results)) {
    warn("fetch", "bad_response");
    return fail("bad_response");
  }
  const pages: PageText[] = [];
  for (const item of results) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const text = str(o.text).trim();
    if (!text) continue;
    pages.push({
      requestedUrl: str(o.url),
      url: str(o.final_url) || str(o.url),
      title: clip(str(o.title), 200),
      text: text.length > PAGE_TEXT_MAX ? text.slice(0, PAGE_TEXT_MAX) : text,
      truncated: text.length > PAGE_TEXT_MAX,
    });
  }
  if (pages.length === 0) return fail("empty", "TinyFish could not read the result pages.");
  return { ok: true, value: pages };
}

export async function fetchPage(url: string): Promise<WebResult<PageText>> {
  const r = await fetchPages([url]);
  return r.ok ? { ok: true, value: r.value[0] } : r;
}
