import { prisma } from "./prisma";
import { ALERT_TYPES, EVENT_TYPES, SIDES, type AlertType } from "./eventTypes";
import { THRESHOLDS } from "./rules";
import { newRunId, runReplay, type ReplayEvent, type ReplayStats } from "./replay";

// Backtest: replays a recorded time range through the real engine with
// labelled manipulation patterns injected at known timestamps, then scores
// the saved alerts against those labels.
//
// Scoring:
//   - An injected episode is detected when an alert of the same rule on the
//     same symbol is saved between its start and end + MATCH_WINDOW_MS.
//   - Alerts inside a matching episode window are true positives; every
//     other alert counts as a false positive. Real recorded data can contain
//     genuine manipulation, so precision here is a lower bound.
//   - Latency is first matching alert time minus episode start, measured on
//     the simulated (event-time) clock.
//   - Dual-model agreement comes from the engine's gray-zone checks: the
//     share of runs where two models answered and agreed.

const [PLACE, CANCEL, FILL] = EVENT_TYPES;
const [BUY, SELL] = SIDES;
const [QUOTE_STUFFING, SPOOFING, BOOK_IMBALANCE] = ALERT_TYPES;

export const MATCH_WINDOW_MS = 60_000;
const WARMUP_MS = 5 * 60_000; // imbalance needs a 5-minute lookback
const TAIL_MS = 90_000;
const MIN_SPACING_MS = 2 * 60_000; // keeps 60s windows and 30s dedupe apart
const QS_BURST_MS = 5_000;
const QS_MIN_ORDERS = 50;
const IMB_WALL_ORDERS = 10;
const IMB_WALL_MS = 1_000;
const INJECTED_PREFIX = "INJ-";

export type BacktestOptions = {
  symbols: string[];
  from: Date;
  to: Date;
  speed: number;
  injectionsPerRule: number;
  // Multiple of the rule threshold the injected pattern aims for.
  intensity: number;
  maxBurstOrders: number;
  ai: boolean;
  log?: (line: string) => void;
};

export type Episode = {
  id: string;
  symbol: string;
  rule: AlertType;
  start: string;
  end: string;
  events: number;
  detail: string;
  detected: boolean;
  latencyMs: number | null;
  firstVerdict: string | null;
};

export type LatencySummary = { mean: number; median: number; p95: number; max: number };

export type RuleScore = {
  rule: AlertType;
  injected: number;
  detected: number;
  recall: number | null;
  alerts: number;
  truePositives: number;
  falsePositives: number;
  precision: number | null;
  falsePositivesPerHour: number | null;
  verdicts: Record<string, number>;
  latencyMs: LatencySummary | null;
};

export type SymbolHour = {
  symbol: string;
  hour: string;
  counts: Record<AlertType, number>;
  total: number;
  falsePositives: number;
};

export type DualModelStats = {
  runs: number;
  outcomes: Record<string, number>;
  bothAnswered: number;
  agreed: number;
  agreementRate: number | null;
};

export type BacktestResult = {
  version: 1;
  runId: string;
  generatedAt: string;
  config: {
    symbols: string[];
    from: string;
    to: string;
    speed: number;
    injectionsPerRule: number;
    intensity: number;
    matchWindowMs: number;
    ai: boolean;
  };
  replay: ReplayStats;
  dataHours: number;
  rules: RuleScore[];
  alertsPerSymbolHour: SymbolHour[];
  episodes: Episode[];
  dualModel: DualModelStats;
};

// --- Injection ---------------------------------------------------------------

type PlannedEpisode = Omit<Episode, "detected" | "latencyMs" | "firstVerdict"> & { injected: ReplayEvent[] };

async function marketAt(symbol: string, t: number) {
  const at = new Date(t);
  const [lastFill, lastAny, counts, placeVolume] = await Promise.all([
    prisma.orderEvent.findFirst({
      where: { symbol, eventType: FILL, createdAt: { lte: at } },
      orderBy: { createdAt: "desc" },
      select: { price: true },
    }),
    prisma.orderEvent.findFirst({
      where: { symbol, createdAt: { lte: at } },
      orderBy: { createdAt: "desc" },
      select: { price: true },
    }),
    prisma.orderEvent.groupBy({
      by: ["eventType"],
      where: { symbol, createdAt: { gte: new Date(t - 60_000), lte: at } },
      _count: { _all: true },
    }),
    prisma.orderEvent.aggregate({
      where: { symbol, eventType: PLACE, createdAt: { gte: new Date(t - 5 * 60_000), lte: at } },
      _sum: { size: true },
    }),
  ]);
  const count = (type: string) => counts.find((c) => c.eventType === type)?._count._all ?? 0;
  return {
    price: lastFill?.price ?? lastAny?.price ?? 100,
    placed60: count(PLACE),
    filled60: count(FILL),
    // Average place volume per 5-second bucket over the last 5 minutes.
    bucketVolume: (placeVolume._sum.size ?? 0) / 60,
  };
}

function round(price: number) {
  return Number(price.toPrecision(8));
}

async function planEpisodes(opts: BacktestOptions): Promise<PlannedEpisode[]> {
  const log = opts.log ?? (() => {});
  const start = opts.from.getTime() + WARMUP_MS;
  const end = opts.to.getTime() - TAIL_MS;
  const rules: AlertType[] = [QUOTE_STUFFING, SPOOFING, BOOK_IMBALANCE];
  let perSymbol = opts.injectionsPerRule * rules.length;
  if (perSymbol === 0) return [];
  const span = end - start;
  if (span < MIN_SPACING_MS) {
    log(`range too short to inject (need > ${(WARMUP_MS + TAIL_MS + MIN_SPACING_MS) / 60_000} min); no injections`);
    return [];
  }
  if (span / perSymbol < MIN_SPACING_MS) {
    const fit = Math.floor(span / MIN_SPACING_MS);
    log(`range fits ${fit} episodes per symbol at 2-minute spacing; reducing from ${perSymbol}`);
    perSymbol = fit;
  }
  const spacing = span / perSymbol;

  const episodes: PlannedEpisode[] = [];
  for (const symbol of opts.symbols) {
    for (let k = 0; k < perSymbol; k++) {
      const rule = rules[k % rules.length];
      const t0 = Math.round(start + spacing * (k + 0.5));
      const m = await marketAt(symbol, t0);
      const id = `${symbol}-${rule}-${k + 1}`;
      const account = `${INJECTED_PREFIX}${id}`;
      const ev = (dt: number, eventType: string, side: string, price: number, size: number, accountId = account): ReplayEvent => ({
        symbol,
        accountId,
        side,
        price: round(price),
        size,
        eventType,
        createdAt: new Date(t0 + dt),
      });
      const injected: ReplayEvent[] = [];
      let detail = "";
      let duration = 0;
      // Alternate the manipulated side between episodes of the same rule.
      const up = Math.floor(k / rules.length) % 2 === 0;

      if (rule === QUOTE_STUFFING) {
        // Enough placements to push the 60s order-to-trade ratio to
        // intensity x the flag line, given the recorded baseline.
        const target = Math.ceil(opts.intensity * THRESHOLDS.otrFlag * Math.max(m.filled60, 1));
        const n = Math.min(opts.maxBurstOrders, Math.max(QS_MIN_ORDERS, target - m.placed60));
        duration = QS_BURST_MS;
        for (let i = 0; i < n; i++) {
          const side = i % 2 ? SELL : BUY;
          const price = m.price * (side === BUY ? 0.9999 : 1.0001);
          injected.push(ev(Math.floor((i * QS_BURST_MS) / n), PLACE, side, price, 1 + (i % 5)));
        }
        detail = `${n} orders in ${QS_BURST_MS / 1000}s (baseline 60s: ${m.placed60} placed, ${m.filled60} filled)${n < target - m.placed60 ? `; capped below the ${target - m.placed60} needed` : ""}`;
      } else if (rule === SPOOFING) {
        // A large resting order, prints moving toward it, then a cancel
        // 1.5s after placement.
        const side = up ? BUY : SELL;
        const dir = up ? 1 : -1;
        const size = THRESHOLDS.largeOrder * 4;
        const restPrice = m.price * (1 - dir * 0.0002);
        injected.push(ev(0, PLACE, side, restPrice, size));
        [300, 700, 1100].forEach((dt, i) =>
          injected.push(ev(dt, FILL, side, m.price * (1 + dir * 0.0001 * (i + 1)), 5, `${account}-TAPE`)),
        );
        duration = 1_500;
        injected.push(ev(duration, CANCEL, side, restPrice, size));
        detail = `${side} ${size} lots rested 1.5s while 3 prints moved ${up ? "up" : "down"} 0.03%`;
      } else {
        // A one-sided wall far larger than a normal 5-second bucket.
        const side = up ? BUY : SELL;
        const total = Math.max(100, Math.round(m.bucketVolume * opts.intensity * 5));
        const each = Math.ceil(total / IMB_WALL_ORDERS);
        duration = IMB_WALL_MS;
        for (let i = 0; i < IMB_WALL_ORDERS; i++) {
          const price = m.price * (side === BUY ? 0.9999 : 1.0001);
          injected.push(ev(Math.floor((i * IMB_WALL_MS) / IMB_WALL_ORDERS), PLACE, side, price, each));
        }
        detail = `${side} wall of ${each * IMB_WALL_ORDERS} lots in 1s (avg 5s bucket ${Math.round(m.bucketVolume)} lots)`;
      }

      episodes.push({
        id,
        symbol,
        rule,
        start: new Date(t0).toISOString(),
        end: new Date(t0 + duration).toISOString(),
        events: injected.length,
        detail,
        injected,
      });
    }
  }
  return episodes;
}

// --- Scoring -------------------------------------------------------------------

function quantile(sorted: number[], q: number) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function summarize(values: number[]): LatencySummary | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  return {
    mean: s.reduce((a, b) => a + b, 0) / s.length,
    median: quantile(s, 0.5),
    p95: quantile(s, 0.95),
    max: s[s.length - 1],
  };
}

const BRAIN_LINE = /^\[brain\] run (\S+) (\S+) -> (\w+)/;
const AGREE = new Set(["agree", "substitute_agree"]);
const BOTH_ANSWERED = new Set(["agree", "disagree", "substitute_agree", "substitute_disagree"]);

export async function runBacktest(opts: BacktestOptions): Promise<BacktestResult> {
  const log = opts.log ?? (() => {});
  const runId = newRunId();
  const planned = await planEpisodes(opts);
  log(`planned ${planned.length} injected episodes (${planned.reduce((n, e) => n + e.events, 0)} events)`);

  // Capture the dual-brain summary lines the engine already logs.
  const brainOutcomes: string[] = [];
  const realInfo = console.info;
  console.info = (...args: unknown[]) => {
    const m = typeof args[0] === "string" ? BRAIN_LINE.exec(args[0]) : null;
    if (m) brainOutcomes.push(m[2]);
    realInfo(...args);
  };

  let replay: ReplayStats;
  try {
    replay = await runReplay({
      symbols: opts.symbols,
      from: opts.from,
      to: opts.to,
      speed: opts.speed,
      runId,
      extraEvents: planned.flatMap((e) => e.injected),
      log,
    });
  } finally {
    console.info = realInfo;
  }

  const alertRows = await prisma.alert.findMany({
    where: { orderEvent: { symbol: { startsWith: replay.prefix } } },
    select: { alertType: true, verdict: true, createdAt: true, orderEvent: { select: { symbol: true } } },
    orderBy: { createdAt: "asc" },
  });
  const alerts = alertRows.map((a) => ({
    rule: a.alertType as AlertType,
    verdict: a.verdict,
    at: a.createdAt.getTime(),
    symbol: a.orderEvent.symbol.slice(replay.prefix.length),
    matched: false,
  }));

  // Match alerts to episodes.
  const episodes: Episode[] = planned.map(({ injected: _injected, ...e }) => {
    const start = Date.parse(e.start);
    const windowEnd = Date.parse(e.end) + MATCH_WINDOW_MS;
    const hits = alerts.filter((a) => a.symbol === e.symbol && a.rule === e.rule && a.at >= start && a.at <= windowEnd);
    for (const h of hits) h.matched = true;
    const first = hits[0];
    return {
      ...e,
      detected: !!first,
      latencyMs: first ? first.at - start : null,
      firstVerdict: first?.verdict ?? null,
    };
  });

  const dataHours = (opts.to.getTime() - opts.from.getTime()) / 3_600_000;
  const symbolHours = dataHours * opts.symbols.length;

  const rules: RuleScore[] = ALERT_TYPES.map((rule) => {
    const eps = episodes.filter((e) => e.rule === rule);
    const ruleAlerts = alerts.filter((a) => a.rule === rule);
    const tp = ruleAlerts.filter((a) => a.matched).length;
    const fp = ruleAlerts.length - tp;
    const detected = eps.filter((e) => e.detected);
    const verdicts: Record<string, number> = {};
    for (const a of ruleAlerts) verdicts[a.verdict] = (verdicts[a.verdict] ?? 0) + 1;
    return {
      rule,
      injected: eps.length,
      detected: detected.length,
      recall: eps.length ? detected.length / eps.length : null,
      alerts: ruleAlerts.length,
      truePositives: tp,
      falsePositives: fp,
      precision: ruleAlerts.length ? tp / ruleAlerts.length : null,
      falsePositivesPerHour: symbolHours > 0 ? fp / symbolHours : null,
      verdicts,
      latencyMs: summarize(detected.map((e) => e.latencyMs ?? 0)),
    };
  });

  // Alerts per symbol per UTC hour, including empty hours.
  const firstHour = Math.floor(opts.from.getTime() / 3_600_000) * 3_600_000;
  const lastHour = Math.floor((opts.to.getTime() - 1) / 3_600_000) * 3_600_000;
  const alertsPerSymbolHour: SymbolHour[] = [];
  for (const symbol of opts.symbols) {
    for (let h = firstHour; h <= lastHour; h += 3_600_000) {
      const inHour = alerts.filter((a) => a.symbol === symbol && a.at >= h && a.at < h + 3_600_000);
      const counts = Object.fromEntries(ALERT_TYPES.map((t) => [t, inHour.filter((a) => a.rule === t).length])) as Record<
        AlertType,
        number
      >;
      alertsPerSymbolHour.push({
        symbol,
        hour: new Date(h).toISOString(),
        counts,
        total: inHour.length,
        falsePositives: inHour.filter((a) => !a.matched).length,
      });
    }
  }

  const outcomes: Record<string, number> = {};
  for (const o of brainOutcomes) outcomes[o] = (outcomes[o] ?? 0) + 1;
  const bothAnswered = brainOutcomes.filter((o) => BOTH_ANSWERED.has(o)).length;
  const agreed = brainOutcomes.filter((o) => AGREE.has(o)).length;

  return {
    version: 1,
    runId,
    generatedAt: new Date().toISOString(),
    config: {
      symbols: opts.symbols,
      from: opts.from.toISOString(),
      to: opts.to.toISOString(),
      speed: opts.speed,
      injectionsPerRule: opts.injectionsPerRule,
      intensity: opts.intensity,
      matchWindowMs: MATCH_WINDOW_MS,
      ai: opts.ai,
    },
    replay,
    dataHours,
    rules,
    alertsPerSymbolHour,
    episodes,
    dualModel: {
      runs: brainOutcomes.length,
      outcomes,
      bothAnswered,
      agreed,
      agreementRate: bothAnswered ? agreed / bothAnswered : null,
    },
  };
}

