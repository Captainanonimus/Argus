import type { OrderEvent } from "@prisma/client";
import { prisma } from "./prisma";
import { runDualBrainCheck } from "./aiBrains";
import {
  ALERT_TYPES,
  EVENT_TYPES,
  SIDES,
  VERDICTS,
  type AlertType,
  type Verdict,
} from "./eventTypes";

// Stateless surveillance engine. Serverless instances share no memory, so
// every evaluation re-reads the recent window for the symbol from Postgres
// and derives all metrics from those rows.

const [PLACE, CANCEL, FILL] = EVENT_TYPES;
const [BUY, SELL] = SIDES;
const [CLEAR, REVIEW, FLAG] = VERDICTS;
const [QUOTE_STUFFING, SPOOFING, BOOK_IMBALANCE] = ALERT_TYPES;

const WINDOW_MS = 60_000;
const IMBALANCE_LOOKBACK_MS = 5 * 60_000;
const BUCKET_MS = 5_000;

const OTR_FLAG_THRESHOLD = 15;
const LARGE_ORDER_SIZE = 500;
const SPOOF_CANCEL_MS = 2_000;
const MIN_BUCKETS = 6;
const Z_FLAG = 3;
const Z_AMBIGUOUS = 1.5;
const RECENT_EVENTS_FOR_BRAINS = 10;
const ALERT_DEDUPE_MS = 30_000;
const BRAIN_THROTTLE_MS = 60_000;

const ENGINE_ERROR_REASON = "engine error - routed to manual review";

export type EvaluationResult = {
  verdict: Verdict;
  reason: string;
  alertTypes: AlertType[];
  metrics: {
    orderToTradeRatio: number | null;
    zScore: number | null;
  };
};

type PendingAlert = {
  alertType: AlertType;
  verdict: Verdict;
  metricValue: number;
  reason: string;
  // Reused from an alert already in the DB - never saved again.
  reused?: boolean;
};

type BrainOutcome = { verdict: Verdict; reason: string };

// Best-effort, per-instance memory of the last dual-brain outcome per symbol.
// Needed because a CLEAR outcome saves no alert, so the DB cannot throttle it.
const brainCache = new Map<string, { at: number; result: BrainOutcome }>();

// --- Rule 1: order-to-trade ratio -----------------------------------------

function orderToTradeRatio(window: OrderEvent[]) {
  let placed = 0;
  let canceled = 0;
  let filled = 0;
  for (const e of window) {
    if (e.eventType === PLACE) placed++;
    else if (e.eventType === CANCEL) canceled++;
    else if (e.eventType === FILL) filled++;
  }
  return {
    counts: { placed, canceled, filled, total: window.length },
    ratio: placed / Math.max(filled, 1),
  };
}

// --- Rule 2: large-order cancel with adverse price move --------------------

// Returns the price move (signed, in the spoofer's favor) when `event` is a
// large cancel placed less than 2s earlier while the market moved against
// the canceled side; otherwise null. The schema has no order id, so the
// cancel is matched to the latest prior place with the same account, side
// and size.
function detectSpoof(event: OrderEvent, rows: OrderEvent[]) {
  if (event.eventType !== CANCEL || event.size <= LARGE_ORDER_SIZE) return null;

  const cancelAt = event.createdAt.getTime();
  const placement = rows
    .filter(
      (e) =>
        e.eventType === PLACE &&
        e.accountId === event.accountId &&
        e.side === event.side &&
        e.size === event.size &&
        e.createdAt.getTime() <= cancelAt &&
        cancelAt - e.createdAt.getTime() <= SPOOF_CANCEL_MS,
    )
    .at(-1);
  if (!placement) return null;

  const placedAt = placement.createdAt.getTime();
  const between = rows.filter((e) => {
    const t = e.createdAt.getTime();
    return t >= placedAt && t <= cancelAt && e.id !== placement.id && e.id !== event.id;
  });
  // Prefer traded prices; fall back to any quoted price in the interval.
  const fills = between.filter((e) => e.eventType === FILL);
  const series = fills.length >= 2 ? fills : between;
  if (series.length < 2) return null;

  const move = series[series.length - 1].price - series[0].price;
  // A resting large bid that pushes price up (or a large offer that pushes
  // it down) and is then pulled is the classic spoof signature.
  const adverse = (event.side === BUY && move > 0) || (event.side === SELL && move < 0);
  if (!adverse) return null;

  return { move, restedMs: cancelAt - placedAt };
}

// --- Rule 3: order-book imbalance z-score ----------------------------------

function imbalanceZScore(rows: OrderEvent[], anchor: number): number | null {
  const start = anchor - IMBALANCE_LOOKBACK_MS;
  const buckets = new Map<number, { bid: number; ask: number }>();
  for (const e of rows) {
    if (e.eventType !== PLACE) continue;
    const idx = Math.floor((e.createdAt.getTime() - start) / BUCKET_MS);
    const b = buckets.get(idx) ?? { bid: 0, ask: 0 };
    if (e.side === BUY) b.bid += e.size;
    else if (e.side === SELL) b.ask += e.size;
    buckets.set(idx, b);
  }

  const series = Array.from(buckets.entries())
    .filter(([, b]) => b.bid + b.ask > 0)
    .sort(([a], [b]) => a - b)
    .map(([, b]) => (b.bid - b.ask) / (b.bid + b.ask));
  if (series.length < MIN_BUCKETS) return null;

  // Compare the latest bucket against the baseline of earlier buckets.
  // Including the latest in its own baseline would cap z below 3 for
  // small bucket counts.
  const latest = series[series.length - 1];
  const baseline = series.slice(0, -1);
  const mean = baseline.reduce((s, v) => s + v, 0) / baseline.length;
  const variance = baseline.reduce((s, v) => s + (v - mean) ** 2, 0) / baseline.length;
  const stdev = Math.sqrt(variance);
  if (stdev === 0) return null;

  return Math.abs(latest - mean) / stdev;
}

// --- Entry point -----------------------------------------------------------

export async function evaluateEvent(event: OrderEvent): Promise<EvaluationResult> {
  try {
    const anchor = event.createdAt.getTime();
    const until = new Date(anchor);
    const [window, lookback] = await Promise.all([
      prisma.orderEvent.findMany({
        where: {
          symbol: event.symbol,
          createdAt: { gte: new Date(anchor - WINDOW_MS), lte: until },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.orderEvent.findMany({
        where: {
          symbol: event.symbol,
          createdAt: { gte: new Date(anchor - IMBALANCE_LOOKBACK_MS), lte: until },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const alerts: PendingAlert[] = [];
    let clearReason = "No surveillance rule fired.";

    const otr = orderToTradeRatio(window);
    if (otr.ratio > OTR_FLAG_THRESHOLD) {
      alerts.push({
        alertType: QUOTE_STUFFING,
        verdict: FLAG,
        metricValue: otr.ratio,
        reason: `Order-to-trade ratio ${otr.ratio.toFixed(1)}:1 over 60s (${otr.counts.placed} placed, ${otr.counts.filled} filled) exceeds ${OTR_FLAG_THRESHOLD}:1.`,
      });
    }

    const spoof = detectSpoof(event, window);
    if (spoof) {
      alerts.push({
        alertType: SPOOFING,
        verdict: FLAG,
        metricValue: event.size,
        reason: `${event.side} order of ${event.size} canceled after ${spoof.restedMs}ms while price moved ${spoof.move > 0 ? "+" : ""}${spoof.move.toFixed(4)} against the canceled side.`,
      });
    }

    const z = imbalanceZScore(lookback, anchor);
    if (z !== null && z > Z_FLAG) {
      alerts.push({
        alertType: BOOK_IMBALANCE,
        verdict: FLAG,
        metricValue: z,
        reason: `Order-book imbalance z-score ${z.toFixed(2)} exceeds ${Z_FLAG}.`,
      });
    } else if (z !== null && z >= Z_AMBIGUOUS && alerts.length === 0) {
      // Ambiguous imbalance and nothing else fired - ask the dual-brain check,
      // at most once per symbol per 60s.
      const reused = await recentBrainOutcome(event.symbol);
      const brains =
        reused ??
        (await runDualBrainCheck({
          symbol: event.symbol,
          counts: otr.counts,
          orderToTradeRatio: otr.ratio,
          zScore: z,
          recentEvents: window.slice(-RECENT_EVENTS_FOR_BRAINS),
        }));
      if (!reused) brainCache.set(event.symbol, { at: Date.now(), result: brains });

      if (brains.verdict === CLEAR) {
        clearReason = brains.reason;
      } else {
        alerts.push({
          alertType: BOOK_IMBALANCE,
          verdict: brains.verdict,
          metricValue: z,
          reason: brains.reason,
          reused: !!reused,
        });
      }
    }

    await saveAlerts(event, alerts);

    const metrics = { orderToTradeRatio: otr.ratio, zScore: z };
    if (alerts.length === 0) {
      return { verdict: CLEAR, reason: clearReason, alertTypes: [], metrics };
    }
    const top = alerts.find((a) => a.verdict === FLAG) ?? alerts[0];
    return {
      verdict: top.verdict,
      reason: alerts.map((a) => a.reason).join(" "),
      alertTypes: alerts.map((a) => a.alertType),
      metrics,
    };
  } catch {
    return {
      verdict: REVIEW,
      reason: ENGINE_ERROR_REASON,
      alertTypes: [],
      metrics: { orderToTradeRatio: null, zScore: null },
    };
  }
}

// Returns a dual-brain outcome for this symbol from the last 60s, if any:
// first the in-memory cache, then any book_imbalance alert in the DB.
async function recentBrainOutcome(symbol: string): Promise<BrainOutcome | null> {
  const cached = brainCache.get(symbol);
  if (cached) {
    if (Date.now() - cached.at < BRAIN_THROTTLE_MS) return cached.result;
    brainCache.delete(symbol);
  }

  const alert = await prisma.alert.findFirst({
    where: {
      alertType: BOOK_IMBALANCE,
      createdAt: { gte: new Date(Date.now() - BRAIN_THROTTLE_MS) },
      orderEvent: { symbol },
    },
    orderBy: { createdAt: "desc" },
    select: { verdict: true, reason: true },
  });
  if (!alert) return null;
  const verdict = VERDICTS.find((v) => v === alert.verdict) ?? REVIEW;
  return { verdict, reason: alert.reason };
}

// Saves alerts, skipping reused ones and any whose alertType already has an
// alert for the same symbol in the last 30s. The caller still reports them.
async function saveAlerts(event: OrderEvent, alerts: PendingAlert[]) {
  const since = new Date(Date.now() - ALERT_DEDUPE_MS);
  const fresh: PendingAlert[] = [];
  for (const a of alerts) {
    if (a.reused) continue;
    const existing = await prisma.alert.findFirst({
      where: {
        alertType: a.alertType,
        createdAt: { gte: since },
        orderEvent: { symbol: event.symbol },
      },
      select: { id: true },
    });
    if (!existing) fresh.push(a);
  }
  if (fresh.length === 0) return;
  await prisma.alert.createMany({
    data: fresh.map(({ alertType, verdict, metricValue, reason }) => ({
      orderEventId: event.id,
      alertType,
      verdict,
      metricValue,
      reason,
    })),
  });
}
