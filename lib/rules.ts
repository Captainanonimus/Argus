import type { AlertType } from "./eventTypes";
import { fmtInt } from "./format";

// Plain-language description of the surveillance rules. The numbers mirror
// the constants in lib/surveillanceEngine.ts; that file is the source of truth.

export const THRESHOLDS = {
  otrWindowS: 60,
  otrFlag: 15,
  largeOrder: 500,
  spoofCancelMs: 2000,
  bucketS: 5,
  imbalanceLookbackMin: 5,
  minBuckets: 6,
  zReview: 1.5,
  zFlag: 3,
  dedupeS: 30,
} as const;

export type RuleDoc = {
  type: AlertType;
  code: string;
  name: string;
  what: string;
  threshold: string;
  why: string;
  example: string;
  scenario: string;
};

const T = THRESHOLDS;

export const RULES: RuleDoc[] = [
  {
    type: "quote_stuffing",
    code: "R1",
    name: "Quote stuffing",
    what: `Counts orders placed and orders filled on the symbol over the last ${T.otrWindowS} seconds and divides one by the other (the order-to-trade ratio). When nothing has filled, the ratio uses one fill as the floor.`,
    threshold: `Flag when the ratio is above ${T.otrFlag}:1.`,
    why: "Flooding the book with orders that never trade slows other participants' market data and order handling, and can hide a real order among the noise. Regulators treat excessive order-to-trade ratios as a marker of disorderly trading.",
    example: `48 orders placed and 1 fill in the last minute gives 48.0:1, which is above ${T.otrFlag}:1, so the event is flagged.`,
    scenario: "quote_stuffing",
  },
  {
    type: "spoofing",
    code: "R2",
    name: "Spoofing",
    what: `Looks at every cancel larger than ${fmtInt(T.largeOrder)} shares. It finds the matching placement (same account, side and size) and checks whether the order was pulled within ${T.spoofCancelMs / 1000} seconds while the price moved in the direction that order would push it.`,
    threshold: `Flag when the canceled size is above ${fmtInt(T.largeOrder)}, it rested less than ${T.spoofCancelMs / 1000}s, and the price moved toward the canceled side (up for a bid, down for an offer).`,
    why: "A large resting bid signals demand that is not real. Other traders lift the price, the spoofer sells into the move, and the bid disappears before anyone can hit it.",
    example: "Account ACC-7731 bids 5,000 at 99.98, trades print up from 100.01 to 100.07, and the bid is canceled 1.6s later. The move was +0.06 toward the bid, so the cancel is flagged.",
    scenario: "spoofing",
  },
  {
    type: "book_imbalance",
    code: "R3",
    name: "Order-book imbalance",
    what: `Splits the last ${T.imbalanceLookbackMin} minutes of new orders into ${T.bucketS}-second buckets and measures each bucket's imbalance, (bid size minus ask size) divided by total size. The latest bucket is compared with the earlier ones as a z-score. At least ${T.minBuckets} buckets with orders are needed.`,
    threshold: `Flag above z ${T.zFlag}. Between z ${T.zReview} and ${T.zFlag} (the gray zone) two independent models review the context and their joint answer decides CLEAR, REVIEW or FLAG. If the models are unavailable the event is routed to REVIEW.`,
    why: "A sudden one-sided wall of orders can pressure the price or bait other algorithms. Measuring it against the symbol's own recent behaviour avoids flagging markets that are always lopsided.",
    example: "Five earlier buckets sit close to balanced (imbalance near 0). Then 2,400 shares of bids arrive with no offers. The new bucket is many standard deviations away, so it is flagged.",
    scenario: "book_imbalance",
  },
];

export function ruleFor(type: string): RuleDoc | undefined {
  return RULES.find((r) => r.type === type);
}

// One-paragraph explanation of the metric that triggered an alert.
export function explainMetric(type: string, value: number, symbol: string): string {
  if (type === "quote_stuffing") {
    return `In the ${T.otrWindowS} seconds up to this event, ${symbol} saw ${value.toFixed(1)} orders placed for every fill. Argus flags anything above ${T.otrFlag} to 1, so this ratio is ${(value / T.otrFlag).toFixed(1)} times the limit. Check whether one account produced most of the orders and whether they were canceled quickly.`;
  }
  if (type === "spoofing") {
    return `An order for ${fmtInt(value)} shares (the large-order line is ${fmtInt(T.largeOrder)}) was canceled less than ${T.spoofCancelMs / 1000} seconds after it was placed, while the price moved in the direction that order would push it. Check whether the same account traded on the other side during that move.`;
  }
  if (type === "book_imbalance") {
    const band =
      value > T.zFlag
        ? `above the flag line of ${T.zFlag}`
        : value >= T.zReview
          ? `in the gray zone between ${T.zReview} and ${T.zFlag}, so two models reviewed it`
          : `below the review line of ${T.zReview}`;
    return `The latest ${T.bucketS}-second bucket of new orders on ${symbol} was ${value.toFixed(2)} standard deviations away from the symbol's recent balance between bids and offers. That is ${band}. Check which side the new orders were on and whether they were later canceled.`;
  }
  return "No explanation is available for this alert type.";
}
