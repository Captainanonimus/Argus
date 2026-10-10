// Throwaway end-to-end check of the API routes against the real DB.
// Not imported by the app. Two modes:
//   direct (default) - calls the route handlers in-process:
//     npx tsx --env-file=.env --env-file=.env.local scripts/test-api.ts
//   http - fetches a server you started yourself (npm run dev / start):
//     npx tsx --env-file=.env --env-file=.env.local scripts/test-api.ts --base http://localhost:3000
//
// Writes only symbols starting with "SIMAPI" plus one control event under
// "ZZAPICTRL", and removes all of them at the end. The demo-reset check
// deletes every "SIM*" symbol, so it is skipped when other SIM data exists
// unless --allow-reset is passed.

import { prisma } from "../lib/prisma";
import * as events from "../app/api/events/route";
import * as batch from "../app/api/events/batch/route";
import * as symbols from "../app/api/symbols/route";
import * as feed from "../app/api/feed/route";
import * as stats from "../app/api/stats/route";
import * as chart from "../app/api/chart/route";
import * as alerts from "../app/api/alerts/route";
import * as alertById from "../app/api/alerts/[id]/route";
import * as alertExport from "../app/api/alerts/export/route";
import * as demoReset from "../app/api/demo/reset/route";
import * as setOpenRouter from "../app/api/settings/openrouter/route";
import * as setTinyFish from "../app/api/settings/tinyfish/route";
import * as settingsStatus from "../app/api/settings/status/route";

const argv = process.argv.slice(2);
const baseIdx = argv.indexOf("--base");
const BASE = baseIdx >= 0 ? argv[baseIdx + 1]?.replace(/\/$/, "") : null;
const ALLOW_RESET = argv.includes("--allow-reset");
const ORIGIN = BASE ?? "http://localhost";

const SYMBOL = "SIMAPI";
const CONTROL = "ZZAPICTRL";
const FAKE_KEY = "test-key-not-real-0123456789";
const REAL_KEYS = [process.env.OPENROUTER_API_KEY, process.env.TINYFISH_API_KEY].filter(
  (k): k is string => !!k && k.length >= 8,
);

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`);
}

// --- Request plumbing ------------------------------------------------------

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;
type Route = { pattern: RegExp; mod: Record<string, unknown> };

const ROUTES: Route[] = [
  { pattern: /^\/api\/events\/batch$/, mod: batch },
  { pattern: /^\/api\/events$/, mod: events },
  { pattern: /^\/api\/symbols$/, mod: symbols },
  { pattern: /^\/api\/feed$/, mod: feed },
  { pattern: /^\/api\/stats$/, mod: stats },
  { pattern: /^\/api\/chart$/, mod: chart },
  { pattern: /^\/api\/alerts\/export$/, mod: alertExport },
  { pattern: /^\/api\/alerts\/([^/]+)$/, mod: alertById },
  { pattern: /^\/api\/alerts$/, mod: alerts },
  { pattern: /^\/api\/demo\/reset$/, mod: demoReset },
  { pattern: /^\/api\/settings\/openrouter$/, mod: setOpenRouter },
  { pattern: /^\/api\/settings\/tinyfish$/, mod: setTinyFish },
  { pattern: /^\/api\/settings\/status$/, mod: settingsStatus },
];

type Res = { status: number; headers: Headers; text: string; json: any };

async function call(
  method: string,
  path: string,
  body?: unknown,
  opts: { raw?: string; contentType?: string | null } = {},
): Promise<Res> {
  const headers: Record<string, string> = {};
  const contentType = opts.contentType === undefined ? "application/json" : opts.contentType;
  if (contentType && (body !== undefined || opts.raw !== undefined)) {
    headers["Content-Type"] = contentType;
  }
  const init: RequestInit = {
    method,
    headers,
    body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  };
  const url = `${ORIGIN}${path}`;

  let res: Response;
  if (BASE) {
    res = await fetch(url, init);
  } else {
    const pathname = new URL(url).pathname;
    const route = ROUTES.find((r) => r.pattern.test(pathname));
    const handler = route?.mod[method] as Handler | undefined;
    if (!route || !handler) throw new Error(`no handler for ${method} ${pathname}`);
    const id = pathname.match(route.pattern)?.[1];
    const params: Record<string, string> = id ? { id } : {};
    res = await handler(new Request(url, init), { params });
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // CSV or empty
  }
  return { status: res.status, headers: res.headers, text, json };
}

function leaksKey(text: string) {
  return [FAKE_KEY, ...REAL_KEYS].some((k) => text.includes(k));
}

async function cleanup() {
  await prisma.orderEvent.deleteMany({
    where: { OR: [{ symbol: { startsWith: SYMBOL } }, { symbol: CONTROL }] },
  });
}

// --- Tests -----------------------------------------------------------------

async function testSettings() {
  console.log("\n[settings]");
  const status = await call("GET", "/api/settings/status");
  check("status 200", status.status === 200);
  check(
    "status has booleans only",
    ["openrouter", "tinyfish", "db"].every((k) => typeof status.json?.[k] === "boolean"),
    JSON.stringify(status.json),
  );
  check("status db reachable", status.json?.db === true);
  check("status leaks no key", !leaksKey(status.text));

  for (const [name, path] of [
    ["openrouter", "/api/settings/openrouter"],
    ["tinyfish", "/api/settings/tinyfish"],
  ] as const) {
    const noType = await call("POST", path, { key: FAKE_KEY }, { contentType: "text/plain" });
    check(`${name} non-JSON content type -> 415`, noType.status === 415);
    const badJson = await call("POST", path, undefined, { raw: "{nope" });
    check(`${name} malformed JSON -> 400`, badJson.status === 400);
    const empty = await call("POST", path, { key: "   " });
    check(`${name} empty key -> 400`, empty.status === 400);
    const short = await call("POST", path, { key: "abc" });
    check(`${name} short key -> 400`, short.status === 400);
    const spaced = await call("POST", path, { key: "has spaces in it 123" });
    check(`${name} key with spaces -> 400`, spaced.status === 400);

    const ok = await call("POST", path, { key: FAKE_KEY });
    const cookie = ok.headers.get("set-cookie") ?? "";
    check(`${name} save -> 200`, ok.status === 200);
    check(`${name} cookie named ${name}_key`, cookie.startsWith(`${name}_key=`));
    check(`${name} cookie HttpOnly`, /httponly/i.test(cookie));
    check(`${name} cookie SameSite=lax`, /samesite=lax/i.test(cookie));
    check(`${name} cookie 30 days`, /max-age=2592000/i.test(cookie));
    check(
      `${name} cookie Secure only in production`,
      /;\s*secure/i.test(cookie) === (process.env.NODE_ENV === "production"),
    );
    check(`${name} save response leaks no key`, !leaksKey(ok.text));

    const del = await call("DELETE", path);
    const delCookie = del.headers.get("set-cookie") ?? "";
    check(`${name} delete -> 200`, del.status === 200);
    check(`${name} delete expires cookie`, /max-age=0/i.test(delCookie));
  }
}

async function testEvents() {
  console.log("\n[events]");
  const bad = await call("POST", "/api/events", undefined, { raw: "not json" });
  check("malformed JSON -> 400", bad.status === 400 && typeof bad.json?.error === "string");

  const invalid = await call("POST", "/api/events", {
    symbol: "bad symbol!",
    accountId: "",
    side: "HOLD",
    eventType: "modify",
    price: -1,
    size: 1.5,
  });
  check(
    "invalid fields -> 400 with one error each",
    invalid.status === 400 && invalid.json?.details?.length === 6,
    JSON.stringify(invalid.json?.details),
  );

  const ok = await call("POST", "/api/events", {
    symbol: SYMBOL.toLowerCase(),
    accountId: "acct-1",
    side: "buy",
    eventType: "PLACE",
    price: 100,
    size: 10,
  });
  check("valid event -> 201", ok.status === 201, `status ${ok.status}`);
  check("symbol/side/type normalized", ok.json?.event?.symbol === SYMBOL && ok.json?.event?.side === "BUY" && ok.json?.event?.eventType === "place");
  check(
    "returns verdict/reason/alertTypes",
    typeof ok.json?.verdict === "string" && typeof ok.json?.reason === "string" && Array.isArray(ok.json?.alertTypes),
  );
}

async function testBatch() {
  console.log("\n[batch]");
  const empty = await call("POST", "/api/events/batch", []);
  check("empty batch -> 400", empty.status === 400);
  const shape = await call("POST", "/api/events/batch", { nope: true });
  check("wrong shape -> 400", shape.status === 400);

  const one = { symbol: `${SYMBOL}B`, accountId: "a", side: "BUY", eventType: "place", price: 1, size: 1 };
  const tooMany = await call("POST", "/api/events/batch", Array.from({ length: 201 }, () => one));
  check("201 events -> 400", tooMany.status === 400);

  const mixed = await call("POST", "/api/events/batch", [one, { ...one, side: "NOPE" }]);
  const savedB = await prisma.orderEvent.count({ where: { symbol: `${SYMBOL}B` } });
  check("one invalid -> 400 and nothing saved", mixed.status === 400 && savedB === 0 && mixed.json?.details?.[0]?.index === 1);

  // Quote-stuffing burst: 40 places then 1 fill inside 60s -> FLAG.
  const t0 = Date.now() - 10_000;
  const burst = Array.from({ length: 40 }, (_, i) => ({
    symbol: SYMBOL,
    accountId: "acct-burst",
    side: i % 2 ? "SELL" : "BUY",
    eventType: "place",
    price: 100 + (i % 2 ? 0.01 * (i % 5 + 1) : -0.01 * (i % 5 + 1)),
    size: 100,
    createdAt: new Date(t0 + i * 200).toISOString(),
  }));
  burst.push({ ...burst[0], eventType: "fill", price: 100, createdAt: new Date(t0 + 8_500).toISOString() });

  const res = await call("POST", "/api/events/batch", { events: burst });
  check("batch -> 200", res.status === 200, `status ${res.status}`);
  check("one result per event, in order", res.json?.results?.length === 41 && res.json.results.every((r: any, i: number) => r.index === i));
  check("summary totals", res.json?.summary?.total === 41 && res.json?.summary?.failed === 0, JSON.stringify(res.json?.summary));
  const last = res.json?.results?.at(-1);
  check("burst ends in FLAG quote_stuffing", last?.verdict === "FLAG" && last?.alertTypes?.includes("quote_stuffing"), `${last?.verdict} ${last?.alertTypes}`);

  // Second symbol, so there are two alerts to paginate over.
  const second = burst.slice(0, 20).map((e) => ({ ...e, symbol: `${SYMBOL}2` }));
  second.push({ ...burst[burst.length - 1], symbol: `${SYMBOL}2` });
  const res2 = await call("POST", "/api/events/batch", second);
  check("second burst flags", res2.json?.results?.at(-1)?.verdict === "FLAG");
}

async function testReads() {
  console.log("\n[reads]");
  const sym = await call("GET", "/api/symbols");
  const mine = sym.json?.symbols?.find((s: any) => s.symbol === SYMBOL);
  check("symbols lists test symbol", sym.status === 200 && !!mine);
  check("symbols count + last price", mine?.eventCount === 42 && mine?.lastPrice === 100, JSON.stringify(mine));

  const f = await call("GET", `/api/feed?symbol=${SYMBOL}&limit=5`);
  const times = (f.json?.events ?? []).map((e: any) => new Date(e.createdAt).getTime());
  check("feed limit + newest first", f.status === 200 && times.length === 5 && times.every((t: number, i: number) => i === 0 || times[i - 1] >= t));
  const f50 = await call("GET", `/api/feed?symbol=${SYMBOL}`);
  check("feed events carry alerts", f50.json?.events?.some((e: any) => e.alerts?.length > 0));
  check("feed default limit 50", (await call("GET", "/api/feed")).json?.events?.length <= 50);
  check("feed limit=500 -> 400", (await call("GET", "/api/feed?limit=500")).status === 400);
  check("feed limit=abc -> 400", (await call("GET", "/api/feed?limit=abc")).status === 400);
  check("feed bad symbol -> 400", (await call("GET", "/api/feed?symbol=%20bad!")).status === 400);

  const s = await call("GET", `/api/stats?symbol=${SYMBOL}`);
  check("stats 200", s.status === 200);
  check("stats totals", s.json?.totals?.events === 42 && s.json?.totals?.eventsByType?.fill === 1, JSON.stringify(s.json?.totals));
  check("stats flags/openAlerts", s.json?.flags >= 1 && s.json?.openAlerts >= 1);
  const bids = s.json?.orderBook?.bids ?? [];
  const asks = s.json?.orderBook?.asks ?? [];
  check(
    "order book <=5 levels, bids desc, asks asc",
    bids.length > 0 && asks.length > 0 && bids.length <= 5 && asks.length <= 5 &&
      bids.every((l: any, i: number) => i === 0 || bids[i - 1].price > l.price) &&
      asks.every((l: any, i: number) => i === 0 || asks[i - 1].price < l.price),
  );
  check("global stats has null book", (await call("GET", "/api/stats")).json?.orderBook === null);

  const c = await call("GET", `/api/chart?symbol=${SYMBOL}&seconds=300`);
  const candle = c.json?.candles?.[0];
  check("chart candles", c.status === 200 && c.json?.candles?.length > 0 && ["time", "open", "high", "low", "close", "volume"].every((k) => typeof candle?.[k] === "number"));
  check("chart markers", c.json?.markers?.some((m: any) => m.verdict === "FLAG" && m.alertType === "quote_stuffing"));
  const none = await call("GET", "/api/chart?symbol=SIMNODATA");
  check("chart no data -> 200 empty arrays", none.status === 200 && none.json?.candles?.length === 0 && none.json?.markers?.length === 0);
  check("chart no symbol -> 400", (await call("GET", "/api/chart")).status === 400);
  check("chart seconds=0 -> 400", (await call("GET", `/api/chart?symbol=${SYMBOL}&seconds=0`)).status === 400);
}

async function testAlerts() {
  console.log("\n[alerts]");
  const list = await call("GET", `/api/alerts?symbol=${SYMBOL}`);
  check("alerts list for symbol", list.status === 200 && list.json?.alerts?.length === 1);
  const alert = list.json?.alerts?.[0];
  check("alert has defaults + event", alert?.status === "open" && alert?.note === "" && !!alert?.updatedAt && alert?.orderEvent?.symbol === SYMBOL);

  for (const q of ["status=bogus", "verdict=maybe", "type=wash_trade", "limit=0", "cursor=bad%20cursor"]) {
    check(`alerts ${q} -> 400`, (await call("GET", `/api/alerts?${q}`)).status === 400);
  }
  check(
    "filters combine",
    (await call("GET", `/api/alerts?symbol=${SYMBOL}&verdict=flag&type=quote_stuffing&status=open&q=order-to-trade`)).json?.alerts?.length >= 1,
  );

  // Cursor pagination over the two test alerts (q matches both symbols).
  const p1 = await call("GET", `/api/alerts?limit=1&q=${SYMBOL}`);
  const p2 = await call("GET", `/api/alerts?limit=1&q=${SYMBOL}&cursor=${p1.json?.nextCursor}`);
  check("page 1 has nextCursor", p1.json?.alerts?.length === 1 && !!p1.json?.nextCursor);
  check(
    "page 2 is the other alert and the last page",
    p2.status === 200 && p2.json?.alerts?.length === 1 && p2.json.alerts[0].id !== p1.json.alerts[0].id && p2.json.nextCursor === null,
  );

  const id = alert?.id as string;
  const one = await call("GET", `/api/alerts/${id}`);
  check("alert detail", one.status === 200 && one.json?.alert?.id === id && one.json?.event?.symbol === SYMBOL);
  const eventAt = new Date(one.json?.event?.createdAt).getTime();
  const tl = (one.json?.timeline ?? []).map((e: any) => new Date(e.createdAt).getTime());
  check(
    "timeline within -30s/+10s, oldest first",
    tl.length > 1 && tl.every((t: number, i: number) => t >= eventAt - 30_000 && t <= eventAt + 10_000 && (i === 0 || tl[i - 1] <= t)),
  );
  check("unknown alert -> 404", (await call("GET", "/api/alerts/doesnotexist123")).status === 404);

  const patched = await call("PATCH", `/api/alerts/${id}`, { status: "Escalated", note: 'He said "hi", ok' });
  check("patch -> 200", patched.status === 200 && patched.json?.alert?.status === "escalated");
  check(
    "updatedAt moved",
    new Date(patched.json?.alert?.updatedAt).getTime() > new Date(alert?.updatedAt).getTime(),
  );
  check("patch bad status -> 400", (await call("PATCH", `/api/alerts/${id}`, { status: "closed" })).status === 400);
  check("patch note not string -> 400", (await call("PATCH", `/api/alerts/${id}`, { note: 5 })).status === 400);
  check("patch long note -> 400", (await call("PATCH", `/api/alerts/${id}`, { note: "x".repeat(2001) })).status === 400);
  check("patch unknown field -> 400", (await call("PATCH", `/api/alerts/${id}`, { verdict: "CLEAR" })).status === 400);
  check("patch empty -> 400", (await call("PATCH", `/api/alerts/${id}`, {})).status === 400);
  check("patch unknown id -> 404", (await call("PATCH", "/api/alerts/doesnotexist123", { status: "open" })).status === 404);

  const csv = await call("GET", `/api/alerts/export?symbol=${SYMBOL}&status=escalated`);
  check("export csv type", csv.status === 200 && (csv.headers.get("content-type") ?? "").startsWith("text/csv"));
  check("export filename header", /attachment; filename="argus-alerts-\d{8}T\d{6}\.csv"/.test(csv.headers.get("content-disposition") ?? ""));
  const lines = csv.text.trim().split("\r\n");
  check("export header + 1 row", lines[0].startsWith("alertId,createdAt") && lines.length === 2, `${lines.length} lines`);
  check("export escapes quotes/commas", csv.text.includes('"He said ""hi"", ok"'));

  await call("PATCH", `/api/alerts/${id}`, { note: "=HYPERLINK(1)" });
  const csv2 = await call("GET", `/api/alerts/export?symbol=${SYMBOL}&status=escalated`);
  check("export neutralises formulas", csv2.text.includes(",'=HYPERLINK(1),"));
  check("export bad filter -> 400 JSON", (await call("GET", "/api/alerts/export?verdict=x")).status === 400);
}

async function testReset() {
  console.log("\n[demo reset]");
  const foreignSim = await prisma.orderEvent.count({
    where: { symbol: { startsWith: "SIM" }, NOT: { symbol: { startsWith: SYMBOL } } },
  });
  if (foreignSim > 0 && !ALLOW_RESET) {
    console.log(`SKIP - ${foreignSim} other SIM* events exist; pass --allow-reset to run this check`);
    return;
  }
  await prisma.orderEvent.create({
    data: { symbol: CONTROL, accountId: "ctrl", side: "BUY", eventType: "place", price: 1, size: 1 },
  });
  const res = await call("POST", "/api/demo/reset");
  check("reset -> 200", res.status === 200 && res.json?.deleted?.events >= 63, JSON.stringify(res.json?.deleted));
  check("SIM symbols gone", (await prisma.orderEvent.count({ where: { symbol: { startsWith: "SIM" } } })) === 0);
  check("non-SIM symbol untouched", (await prisma.orderEvent.count({ where: { symbol: CONTROL } })) === 1);
}

async function main() {
  console.log(`mode: ${BASE ? `http ${BASE}` : "direct handler calls"}`);
  await cleanup();
  try {
    await testSettings();
    await testEvents();
    await testBatch();
    await testReads();
    await testAlerts();
    await testReset();
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  console.log(`\n${failures === 0 ? "ALL PASSED" : `${failures} FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch(async (err) => {
  console.error("test run crashed:", err instanceof Error ? err.message : err);
  await prisma.$disconnect();
  process.exitCode = 1;
});
