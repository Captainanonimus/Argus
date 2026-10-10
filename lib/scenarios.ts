import type { AlertType, EventType, Side, Verdict } from "./eventTypes";

// Order-flow scenarios for the simulator. Each generator returns a schedule
// of events with millisecond offsets; the browser posts them one at a time to
// /api/events at that pace and stamps each with createdAt = start + offset,
// so the engine sees the intended timing even if a request is slow.
//
// Tuning notes, checked against lib/surveillanceEngine.ts:
// - Order-to-trade ratio: placed / max(filled, 1) over the last 60s; FLAG > 15.
// - Spoofing: cancel with size > 500, matching place (same account, side,
//   size) within 2000ms, at least two events in between, and the price
//   (fills preferred) moving toward the canceled side.
// - Imbalance: 5s buckets of PLACE sizes over 5 minutes, aligned to the
//   evaluated event's own timestamp. A place event's "latest bucket" holds
//   only orders stamped at that exact millisecond, so its imbalance is
//   usually +1 or -1. z needs 6 non-empty buckets and a non-zero baseline
//   standard deviation; FLAG > 3, gray zone 1.5 to 3 (dual-model check).
// To keep the imbalance rule quiet, ordinary quotes are posted as two-sided
// pairs with equal size at the same millisecond: every bucket then nets to
// exactly 0, the baseline deviation is 0 and z is not computed. The imbalance
// scenarios post their baseline as single-millisecond baskets 6s apart, so
// fewer than 6 buckets exist until the trigger order arrives.

export type ScenarioEvent = {
  at: number; // ms from scenario start
  accountId: string;
  side: Side;
  eventType: EventType;
  price: number;
  size: number;
  note?: string; // what this step represents, shown in the run log
};

export type ScenarioId = "normal" | "quote_stuffing" | "spoofing" | "book_imbalance" | "gray_zone";

export type ScenarioDef = {
  id: ScenarioId;
  name: string;
  summary: string;
  expected: string;
  expectedVerdict: Verdict;
  expectedAlert: AlertType | null;
  needsCleanWindow: boolean;
  generate: (symbol: string) => ScenarioEvent[];
};

// --- Helpers ---------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const TICK = 0.01;

// A stable base price per symbol (between about 40 and 240) so different
// symbols look like different instruments.
function basePrice(symbol: string): number {
  return round2(40 + (hash(symbol) % 20000) / 100);
}

class Tape {
  events: ScenarioEvent[] = [];
  mid: number;
  rand: () => number;

  constructor(symbol: string) {
    this.mid = basePrice(symbol);
    this.rand = mulberry32(hash(symbol) ^ Date.now());
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rand() * list.length)];
  }

  jitter(base: number, spread: number): number {
    return Math.round(base + (this.rand() * 2 - 1) * spread);
  }

  push(e: ScenarioEvent) {
    this.events.push({ ...e, price: round2(e.price) });
  }

  // Two-sided quote with equal size on both sides at the same millisecond.
  quotePair(at: number, accountId: string, size: number, levels = 1) {
    this.push({ at, accountId, side: "BUY", eventType: "place", price: this.mid - TICK * levels, size });
    this.push({ at, accountId, side: "SELL", eventType: "place", price: this.mid + TICK * levels, size });
  }

  // A trade print; the mid walks one tick at most.
  fill(at: number, accountId: string, size: number, drift?: number, note?: string) {
    const step = drift ?? this.pick([-1, 0, 0, 1]) * TICK;
    this.mid = round2(this.mid + step);
    const side: Side = step > 0 ? "BUY" : step < 0 ? "SELL" : this.pick(["BUY", "SELL"] as const);
    this.push({ at, accountId, side, eventType: "fill", price: this.mid, size, note });
  }

  // One basket of resting orders at a single millisecond with exact totals.
  basket(at: number, accountId: string, bid: number, ask: number, note?: string) {
    const b1 = Math.round((bid * 0.6) / 5) * 5;
    const a1 = Math.round((ask * 0.6) / 5) * 5;
    this.push({ at, accountId, side: "BUY", eventType: "place", price: this.mid - TICK, size: b1, note });
    this.push({ at, accountId, side: "BUY", eventType: "place", price: this.mid - 2 * TICK, size: bid - b1 });
    this.push({ at, accountId, side: "SELL", eventType: "place", price: this.mid + TICK, size: a1 });
    this.push({ at, accountId, side: "SELL", eventType: "place", price: this.mid + 2 * TICK, size: ask - a1 });
  }

  done(): ScenarioEvent[] {
    // Stable sort keeps same-millisecond events in insertion order.
    return this.events
      .map((e, i) => ({ e, i }))
      .sort((x, y) => x.e.at - y.e.at || x.i - y.i)
      .map(({ e }) => e);
  }
}

const TAKERS = ["ACC-1042", "ACC-2288", "ACC-3105", "ACC-4471", "ACC-5913", "ACC-6620"] as const;
const MAKERS = ["MM-01", "MM-02"] as const;
const QUOTE_SIZES = [100, 200, 300, 400] as const;

// --- Scenarios -------------------------------------------------------------

// About 40 seconds of ordinary two-sided market making with steady trading.
// Ratio stays near 1:1, cancels are small and every bucket is balanced.
function normalFlow(symbol: string): ScenarioEvent[] {
  const t = new Tape(symbol);
  const live: { at: number; size: number; maker: string; bid: number; ask: number }[] = [];
  let quoteAt = 0;
  let n = 0;
  while (quoteAt <= 38_000) {
    const maker = MAKERS[n % 2];
    const size = t.pick(QUOTE_SIZES);
    t.quotePair(quoteAt, maker, size);
    live.push({ at: quoteAt, size, maker, bid: t.mid - TICK, ask: t.mid + TICK });
    // Every third quote, the maker refreshes an older one: both legs canceled
    // at one millisecond so the book stays two-sided.
    if (n % 3 === 2 && live.length > 2) {
      const old = live.shift()!;
      const at = quoteAt + 400;
      t.push({ at, accountId: old.maker, side: "BUY", eventType: "cancel", price: old.bid, size: old.size });
      t.push({ at, accountId: old.maker, side: "SELL", eventType: "cancel", price: old.ask, size: old.size });
    }
    quoteAt += t.jitter(2200, 400);
    n++;
  }
  for (let at = 600; at <= 39_500; at += t.jitter(1200, 300)) {
    t.fill(at, t.pick(TAKERS), t.pick([50, 100, 100, 200, 300]));
  }
  return t.done();
}

// A short normal prelude with one trade, then one account sprays 16 tiny
// two-sided quotes (32 orders) in about a second and pulls each 20ms later.
// The ratio passes 15:1 around the 12th burst order.
function quoteStuffing(symbol: string): ScenarioEvent[] {
  const t = new Tape(symbol);
  t.quotePair(0, "MM-01", 300);
  t.fill(1000, "ACC-2288", 200, 0, "Last trade before the burst");
  t.quotePair(2000, "MM-02", 200);

  const stuffer = "ACC-3390";
  for (let i = 0; i < 16; i++) {
    const at = 4000 + i * 60;
    const lvl = 1 + (i % 3);
    const bid = t.mid - TICK * lvl;
    const ask = t.mid + TICK * lvl;
    const note = i === 0 ? "Burst starts: 16 quote pairs in under a second" : undefined;
    t.push({ at, accountId: stuffer, side: "BUY", eventType: "place", price: bid, size: 100, note });
    t.push({ at, accountId: stuffer, side: "SELL", eventType: "place", price: ask, size: 100 });
    t.push({ at: at + 20, accountId: stuffer, side: "BUY", eventType: "cancel", price: bid, size: 100 });
    t.push({ at: at + 20, accountId: stuffer, side: "SELL", eventType: "cancel", price: ask, size: 100 });
  }
  t.quotePair(6500, "MM-01", 300);
  return t.done();
}

// Balanced trading, then a 5,000-share bid that the market chases up while
// the same account sells into the move, canceled 1.6s after it was placed.
function spoofing(symbol: string): ScenarioEvent[] {
  const t = new Tape(symbol);
  for (const at of [0, 2000, 4000]) t.quotePair(at, t.pick(MAKERS), t.pick(QUOTE_SIZES));
  for (const at of [700, 1900, 3100, 4300, 5500]) t.fill(at, t.pick(TAKERS), t.pick([100, 200, 300]));

  const spoofer = "ACC-7731";
  const bidPx = round2(t.mid - 2 * TICK);
  t.push({ at: 6000, accountId: spoofer, side: "BUY", eventType: "place", price: bidPx, size: 5000, note: "Large bid placed below the market" });
  t.fill(6300, "ACC-1042", 200, TICK, "Buyers lift the offer");
  t.fill(6650, "ACC-4471", 300, 2 * TICK);
  t.fill(7000, "ACC-5913", 200, 2 * TICK);
  t.mid = round2(t.mid + 2 * TICK);
  t.push({ at: 7350, accountId: spoofer, side: "SELL", eventType: "fill", price: t.mid, size: 1200, note: "Same account sells into the move" });
  t.push({ at: 7600, accountId: spoofer, side: "BUY", eventType: "cancel", price: bidPx, size: 5000, note: "Large bid canceled after 1.6s" });
  t.fill(8200, "ACC-2288", 200, -4 * TICK);
  t.fill(9000, "ACC-3105", 100, -2 * TICK);
  return t.done();
}

// Five near-balanced baskets 6s apart, then a one-sided wall of bids.
// Baseline imbalances +0.05, -0.04, +0.03, -0.06, +0.02 (sd about 0.04);
// a lone bid scores (1 - 0) / 0.04, roughly z 24.
function bookImbalance(symbol: string): ScenarioEvent[] {
  const t = new Tape(symbol);
  const baskets: [number, number][] = [
    [525, 475],
    [480, 520],
    [515, 485],
    [470, 530],
    [510, 490],
  ];
  baskets.forEach(([bid, ask], k) => {
    t.basket(k * 6000, MAKERS[k % 2], bid, ask, k === 0 ? "Balanced baseline basket" : undefined);
    t.fill(k * 6000 + 2000, t.pick(TAKERS), t.pick([100, 200]));
    t.fill(k * 6000 + 4000, t.pick(TAKERS), t.pick([100, 200]));
  });
  const wall = "ACC-5120";
  for (let i = 0; i < 6; i++) {
    t.push({
      at: 30_000,
      accountId: wall,
      side: "BUY",
      eventType: "place",
      price: t.mid - TICK * (1 + (i % 3)),
      size: 400,
      note: i === 0 ? "One-sided wall: 2,400 bid, no offers" : undefined,
    });
  }
  t.fill(31_000, "ACC-4471", 300, TICK);
  t.fill(32_500, "ACC-1042", 200, TICK);
  return t.done();
}

// Same shape with a noisier baseline (+0.6, -0.2, +0.5, -0.3, +0.4; mean 0.2,
// sd about 0.37). A single bid then scores (1 - 0.2) / 0.37, about z 2.1:
// inside the 1.5 to 3 gray zone, so the dual-model check decides.
function grayZone(symbol: string): ScenarioEvent[] {
  const t = new Tape(symbol);
  const baskets: [number, number][] = [
    [400, 100],
    [200, 300],
    [300, 100],
    [350, 650],
    [350, 150],
  ];
  baskets.forEach(([bid, ask], k) => {
    t.basket(k * 6000, MAKERS[k % 2], bid, ask, k === 0 ? "Uneven baseline basket" : undefined);
    t.fill(k * 6000 + 2000, t.pick(TAKERS), t.pick([100, 200]));
    t.fill(k * 6000 + 4000, t.pick(TAKERS), t.pick([100, 200]));
  });
  t.push({
    at: 30_000,
    accountId: "ACC-6620",
    side: "BUY",
    eventType: "place",
    price: t.mid - TICK,
    size: 300,
    note: "Single bid lands in the gray zone",
  });
  t.fill(31_500, "ACC-2288", 100, TICK);
  return t.done();
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: "normal",
    name: "Normal flow",
    summary: "Two market makers quote both sides and takers trade steadily for about 40 seconds.",
    expected: "Every event returns CLEAR. No rule should fire.",
    expectedVerdict: "CLEAR",
    expectedAlert: null,
    needsCleanWindow: true,
    generate: normalFlow,
  },
  {
    id: "quote_stuffing",
    name: "Quote stuffing",
    summary: "One account sends 32 tiny orders in about a second and cancels each one 20ms later, against a single trade.",
    expected: "FLAG for quote stuffing once the order-to-trade ratio passes 15:1.",
    expectedVerdict: "FLAG",
    expectedAlert: "quote_stuffing",
    needsCleanWindow: true,
    generate: quoteStuffing,
  },
  {
    id: "spoofing",
    name: "Spoofing",
    summary: "A 5,000-share bid pulls the price up, the same account sells into the move, then the bid is canceled after 1.6s.",
    expected: "FLAG for spoofing on the cancel.",
    expectedVerdict: "FLAG",
    expectedAlert: "spoofing",
    needsCleanWindow: true,
    generate: spoofing,
  },
  {
    id: "book_imbalance",
    name: "Order-book imbalance",
    summary: "Five balanced baskets of resting orders 6s apart, then a sudden one-sided wall of bids.",
    expected: "FLAG for book imbalance (z far above 3) on the first bid of the wall.",
    expectedVerdict: "FLAG",
    expectedAlert: "book_imbalance",
    needsCleanWindow: true,
    generate: bookImbalance,
  },
  {
    id: "gray_zone",
    name: "Gray-zone imbalance",
    summary: "An uneven baseline, then a single bid that lands at about z 2.1, between the review and flag lines.",
    expected:
      "Two models review it and decide CLEAR, REVIEW or FLAG. Without a working OpenRouter key the event is routed to REVIEW. A rerun within 60 seconds reuses the earlier answer and saves no new alert.",
    expectedVerdict: "REVIEW",
    expectedAlert: "book_imbalance",
    needsCleanWindow: true,
    generate: grayZone,
  },
];

export function scenarioById(id: string): ScenarioDef | undefined {
  return SCENARIOS.find((s) => s.id === id);
}

export function scenarioDurationMs(events: ScenarioEvent[]): number {
  return events.length ? events[events.length - 1].at : 0;
}
