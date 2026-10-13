import type { OrderEvent, Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { evaluateEvent, type EvaluationResult } from "./surveillanceEngine";
import { resetClock, setClock } from "./clock";

// Replays recorded OrderEvent rows through the real surveillance engine.
//
// Each run copies the events into its own namespace (symbol prefixed with
// "RPL-<run>-"), so the engine's per-symbol windows, alert dedupe and the
// dual-brain throttle only ever see this run's data, and recorded rows are
// never modified. While the run is active the engine reads a simulated clock
// set to the time of the event being evaluated; --speed only paces the
// wall-clock delay between events and never changes the results.

export const REPLAY_PREFIX = "RPL-";
const READ_PAGE = 2_000;
const INSERT_BATCH = 200;
const PROGRESS_MS = 5_000;
const ENGINE_ERROR_REASON = "engine error - routed to manual review";

export type ReplayEvent = {
  symbol: string;
  accountId: string;
  side: string;
  price: number;
  size: number;
  eventType: string;
  createdAt: Date;
};

export type ReplayOptions = {
  symbols: string[];
  from: Date;
  to: Date;
  // Simulated seconds per wall second. 0 (or Infinity) replays as fast as
  // the engine allows.
  speed: number;
  runId?: string;
  // Extra events merged into the stream by time (e.g. backtest injections).
  extraEvents?: ReplayEvent[];
  onResult?: (event: OrderEvent, result: EvaluationResult, sourceSymbol: string) => void;
  log?: (line: string) => void;
};

export type ReplayStats = {
  runId: string;
  prefix: string;
  symbols: string[];
  from: string;
  to: string;
  speed: number;
  recordedEvents: number;
  injectedEvents: number;
  evaluated: number;
  engineErrors: number;
  verdicts: Record<string, number>;
  wallMs: number;
  // Achieved simulated-seconds per wall-second.
  effectiveSpeed: number | null;
  // Largest amount the replay fell behind the requested pace, in ms.
  maxLagMs: number;
};

export function newRunId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export function replaySymbol(prefix: string, symbol: string) {
  return `${prefix}${symbol}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Reads recorded events in time order, a page at a time.
async function* readRecorded(symbols: string[], from: Date, to: Date): AsyncGenerator<ReplayEvent> {
  let cursor: string | undefined;
  for (;;) {
    const page: OrderEvent[] = await prisma.orderEvent.findMany({
      where: { symbol: { in: symbols }, createdAt: { gte: from, lt: to } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: READ_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const e of page) yield e;
    if (page.length < READ_PAGE) return;
    cursor = page[page.length - 1].id;
  }
}

// Merges a time-ordered async stream with a time-ordered array.
async function* mergeByTime(a: AsyncGenerator<ReplayEvent>, b: ReplayEvent[]): AsyncGenerator<ReplayEvent> {
  let i = 0;
  for await (const e of a) {
    while (i < b.length && b[i].createdAt.getTime() <= e.createdAt.getTime()) yield b[i++];
    yield e;
  }
  while (i < b.length) yield b[i++];
}

export async function runReplay(opts: ReplayOptions): Promise<ReplayStats> {
  const log = opts.log ?? (() => {});
  const runId = opts.runId ?? newRunId();
  const prefix = `${REPLAY_PREFIX}${runId}-`;
  const speed = opts.speed > 0 && Number.isFinite(opts.speed) ? opts.speed : 0;
  const extra = [...(opts.extraEvents ?? [])].sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());

  const recordedEvents = await prisma.orderEvent.count({
    where: { symbol: { in: opts.symbols }, createdAt: { gte: opts.from, lt: opts.to } },
  });
  const total = recordedEvents + extra.length;
  log(`replay ${runId}: ${recordedEvents} recorded + ${extra.length} injected events, ${opts.symbols.join(", ")}, ${opts.from.toISOString()} -> ${opts.to.toISOString()}, speed ${speed || "max"}`);

  const stats: ReplayStats = {
    runId,
    prefix,
    symbols: opts.symbols,
    from: opts.from.toISOString(),
    to: opts.to.toISOString(),
    speed,
    recordedEvents,
    injectedEvents: extra.length,
    evaluated: 0,
    engineErrors: 0,
    verdicts: {},
    wallMs: 0,
    effectiveSpeed: null,
    maxLagMs: 0,
  };

  let simNow = opts.from.getTime();
  setClock(() => simNow);
  const wallStart = Date.now();
  let simStart: number | null = null;
  let lastProgress = wallStart;

  const processBatch = async (batch: ReplayEvent[]) => {
    const data: Prisma.OrderEventCreateManyInput[] = batch.map((e) => ({
      symbol: replaySymbol(prefix, e.symbol),
      accountId: e.accountId,
      side: e.side,
      price: e.price,
      size: e.size,
      eventType: e.eventType,
      createdAt: e.createdAt,
    }));
    // Postgres returns rows in VALUES order; sort defensively by time.
    const created = await prisma.orderEvent.createManyAndReturn({ data });
    created.sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());

    for (const event of created) {
      const t = event.createdAt.getTime();
      if (simStart === null) simStart = t;
      if (speed > 0) {
        const due = wallStart + (t - simStart) / speed;
        const wait = due - Date.now();
        if (wait > 0) await sleep(wait);
        else stats.maxLagMs = Math.max(stats.maxLagMs, -wait);
      }
      simNow = t;
      const result = await evaluateEvent(event);
      stats.evaluated++;
      stats.verdicts[result.verdict] = (stats.verdicts[result.verdict] ?? 0) + 1;
      if (result.reason === ENGINE_ERROR_REASON) stats.engineErrors++;
      opts.onResult?.(event, result, event.symbol.slice(prefix.length));

      if (Date.now() - lastProgress >= PROGRESS_MS) {
        lastProgress = Date.now();
        const pct = total ? ((stats.evaluated / total) * 100).toFixed(1) : "100";
        log(`  ${stats.evaluated}/${total} (${pct}%) sim ${new Date(t).toISOString()}`);
      }
    }
  };

  try {
    let batch: ReplayEvent[] = [];
    for await (const e of mergeByTime(readRecorded(opts.symbols, opts.from, opts.to), extra)) {
      batch.push(e);
      if (batch.length >= INSERT_BATCH) {
        await processBatch(batch);
        batch = [];
      }
    }
    if (batch.length) await processBatch(batch);
  } finally {
    resetClock();
  }

  stats.wallMs = Date.now() - wallStart;
  const simSpan = simStart === null ? 0 : simNow - simStart;
  stats.effectiveSpeed = stats.wallMs > 0 && simSpan > 0 ? simSpan / stats.wallMs : null;
  return stats;
}

// Removes a run's copied events and their alerts (alerts cascade).
export async function deleteReplayRun(prefix: string) {
  const where = { symbol: { startsWith: prefix } };
  const [alerts, events] = await prisma.$transaction([
    prisma.alert.deleteMany({ where: { orderEvent: where } }),
    prisma.orderEvent.deleteMany({ where }),
  ]);
  return { alerts: alerts.count, events: events.count };
}

// --- Shared CLI helpers -----------------------------------------------------

export function cliArg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function cliFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// Accepts an ISO timestamp, epoch ms, or a relative offset from now such as
// "-30m", "-2h", "-1d".
export function parseTime(input: string, nowMs = Date.now()): Date {
  const rel = /^-(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(input.trim());
  if (rel) {
    const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[rel[2] as "s" | "m" | "h" | "d"];
    return new Date(nowMs - Number(rel[1]) * unit);
  }
  const d = /^\d+$/.test(input) ? new Date(Number(input)) : new Date(input);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid time: ${input}`);
  return d;
}

export function parseSpeed(input: string | undefined, fallback: number): number {
  if (input === undefined) return fallback;
  if (input === "max") return 0;
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid --speed: ${input}`);
  return n;
}

// Default range: everything recorded for the symbols.
export async function recordedRange(symbols: string[]) {
  const agg = await prisma.orderEvent.aggregate({
    where: { symbol: { in: symbols } },
    _min: { createdAt: true },
    _max: { createdAt: true },
  });
  if (!agg._min.createdAt || !agg._max.createdAt) return null;
  return { from: agg._min.createdAt, to: new Date(agg._max.createdAt.getTime() + 1) };
}
