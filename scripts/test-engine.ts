// Throwaway end-to-end check of the surveillance engine against the real DB.
// Not imported by the app. Run with:
//   npx tsx --env-file=.env --env-file=.env.local scripts/test-engine.ts

import type { OrderEvent } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { evaluateEvent } from "../lib/surveillanceEngine";
import { ALERT_TYPES, EVENT_TYPES, SIDES, VERDICTS } from "../lib/eventTypes";

const SYMBOL = "ZZTEST";
const [PLACE, CANCEL, FILL] = EVENT_TYPES;
const [BUY, SELL] = SIDES;
const [, , FLAG] = VERDICTS;
const [QUOTE_STUFFING, SPOOFING] = ALERT_TYPES;

// Count outbound model requests without touching the key.
let openRouterCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("openrouter.ai")) openRouterCalls++;
  return realFetch(input, init);
};

let failures = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`);
}

type NewEvent = {
  accountId: string;
  side: string;
  price: number;
  size: number;
  eventType: string;
  createdAt: Date;
};

async function insert(rows: NewEvent[]): Promise<OrderEvent[]> {
  const created = await prisma.orderEvent.createManyAndReturn({
    data: rows.map((r) => ({ ...r, symbol: SYMBOL })),
  });
  return created.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

async function cleanup() {
  await prisma.alert.deleteMany({ where: { orderEvent: { symbol: SYMBOL } } });
  await prisma.orderEvent.deleteMany({ where: { symbol: SYMBOL } });
}

async function alertCount(alertType: string) {
  return prisma.alert.count({ where: { alertType, orderEvent: { symbol: SYMBOL } } });
}

// Cases are spaced in time so their 60s / 5-minute windows never overlap.
async function caseQuoteStuffing(now: number) {
  console.log("\n[a] quote stuffing burst");
  const t0 = now - 20 * 60_000;
  const rows: NewEvent[] = [
    { accountId: "MM1", side: BUY, price: 100, size: 100, eventType: FILL, createdAt: new Date(t0) },
  ];
  for (let i = 1; i <= 40; i++) {
    rows.push({
      accountId: "STUFFER",
      side: i % 2 ? BUY : SELL,
      price: 100 + (i % 2 ? -0.01 : 0.01),
      size: 100,
      eventType: PLACE,
      createdAt: new Date(t0 + i * 120),
    });
  }
  const events = await insert(rows);

  const results = [];
  for (const e of events.slice(-3).reverse()) {
    const r = await evaluateEvent(e);
    results.push(r);
    console.log(`  verdict=${r.verdict} alertTypes=${r.alertTypes.join(",")} reason=${r.reason}`);
  }
  check(
    "quote stuffing flagged on all 3 evaluations",
    results.every((r) => r.verdict === FLAG && r.alertTypes.includes(QUOTE_STUFFING)),
  );
  const count = await alertCount(QUOTE_STUFFING);
  check("exactly one quote_stuffing Alert row (dedupe)", count === 1, `rows=${count}`);
}

async function caseSpoofing(now: number) {
  console.log("\n[b] spoofing");
  const t0 = now - 10 * 60_000;
  const events = await insert([
    { accountId: "SPOOFER", side: BUY, price: 99.98, size: 800, eventType: PLACE, createdAt: new Date(t0) },
    { accountId: "MM1", side: SELL, price: 100.0, size: 50, eventType: FILL, createdAt: new Date(t0 + 200) },
    { accountId: "MM2", side: SELL, price: 100.03, size: 50, eventType: FILL, createdAt: new Date(t0 + 500) },
    { accountId: "MM1", side: SELL, price: 100.06, size: 50, eventType: FILL, createdAt: new Date(t0 + 800) },
    { accountId: "SPOOFER", side: BUY, price: 99.98, size: 800, eventType: CANCEL, createdAt: new Date(t0 + 1000) },
  ]);
  const r = await evaluateEvent(events[events.length - 1]);
  console.log(`  verdict=${r.verdict} alertTypes=${r.alertTypes.join(",")} reason=${r.reason}`);
  check("spoofing flagged", r.verdict === FLAG && r.alertTypes.includes(SPOOFING));
}

async function caseGrayZone(now: number) {
  console.log("\n[c] gray-zone book imbalance");
  // Baseline imbalances (mean 0, stdev ~0.0935), then a latest bucket at
  // +0.206, giving z ~2.2. Fills keep the order-to-trade ratio at 1:1.
  const imbalances = [0.1, -0.1, 0.05, -0.05, 0.15, -0.15, 0, 0, 0.206];
  const t0 = now - 2_000;
  const rows: NewEvent[] = [];
  imbalances.forEach((x, i) => {
    const at = new Date(t0 - (imbalances.length - 1 - i) * 5_000);
    const bid = Math.round(500 * (1 + x));
    rows.push(
      { accountId: "MM1", side: BUY, price: 100, size: 10, eventType: FILL, createdAt: at },
      { accountId: "MM2", side: SELL, price: 100, size: 10, eventType: FILL, createdAt: at },
      { accountId: "MM1", side: BUY, price: 99.99, size: bid, eventType: PLACE, createdAt: at },
      { accountId: "MM2", side: SELL, price: 100.01, size: 1000 - bid, eventType: PLACE, createdAt: at },
    );
  });
  const events = await insert(rows);
  const latest = events[events.length - 1];

  const before = openRouterCalls;
  const r = await evaluateEvent(latest);
  const calls = openRouterCalls - before;
  const z = r.metrics.zScore;
  console.log(`  z=${z?.toFixed(3)} verdict=${r.verdict}`);
  console.log(`  reason=${r.reason}`);
  console.log(`  OpenRouter calls=${calls}`);
  check("z in ambiguous band [1.5, 3]", z !== null && z >= 1.5 && z <= 3, `z=${z?.toFixed(3)}`);
  check("dual-brain check made at most 3 model calls", calls <= 3, `calls=${calls}`);

  console.log("\n[d] throttle: re-evaluate gray-zone immediately");
  const beforeAgain = openRouterCalls;
  const again = await evaluateEvent(latest);
  const callsAgain = openRouterCalls - beforeAgain;
  console.log(`  verdict=${again.verdict} OpenRouter calls=${callsAgain}`);
  check("no new model calls within 60s", callsAgain === 0, `calls=${callsAgain}`);
  check("throttled result matches first result", again.verdict === r.verdict && again.reason === r.reason);
}

async function main() {
  await cleanup();
  try {
    const now = Date.now();
    await caseQuoteStuffing(now);
    await caseSpoofing(now);
    await caseGrayZone(now);
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error("test run crashed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
