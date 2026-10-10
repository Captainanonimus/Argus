"use client";

import { motion, useTransform, type MotionValue } from "framer-motion";
import {
  heroAsks,
  heroBids,
  SAMPLE_SYMBOL,
  SPOOF_REST_SECONDS,
  SPOOF_SIZE,
  type Level,
} from "@/lib/sample-market";

// Gradient runs coral at the price column, so any figure that sits over the
// bar lands on the high-contrast (coral/magenta) end.
const BID_GRADIENT = "linear-gradient(260deg, #FF6B4A 0%, #E8407E 52%, #8B5CF6 100%)";
const FLAT_GRADIENT = "linear-gradient(100deg, #FF6B4A 0%, #E8407E 52%, #8B5CF6 100%)";
const BAR_REFERENCE = 3600;

const fmtSize = (n: number) => (Math.round(n / 100) * 100).toLocaleString("en-US");
const fmtPrice = (n: number) => n.toFixed(2);
const barWidth = (size: number) => `${Math.min(100, (size / BAR_REFERENCE) * 62)}%`;

// Timeline, as fractions of `progress` (0..1):
//   0.02-0.15  spoof bid appears, size spikes
//   0.15-0.45  holds; best ask leans in at 0.36
//   0.45-0.53  canceled a beat before the spread closes
//   0.55-0.76  row and badge flip through the gradient, caption lands
const T = {
  spikeIn: [0.02, 0.15],
  cancel: [0.45, 0.53],
  askLean: 0.36,
  rowFlip: [0.55, 0.72],
  badgeFlip: [0.6, 0.76],
  caption: [0.72, 0.8],
} as const;

type Props = {
  /** 0..1 sequence position. Pass a constant 1 to render the final state. */
  progress: MotionValue<number>;
};

export function OrderBookLadder({ progress }: Props) {
  const base = heroBids[0].size;
  const keys = [T.spikeIn[0], T.spikeIn[1], T.cancel[0], T.cancel[1]];

  const spikeScale = useTransform(progress, keys, [0, 1, 1, 0]);
  const spoofSize = useTransform(progress, keys, [base, base + SPOOF_SIZE, base + SPOOF_SIZE, base]);
  const spoofSizeText = useTransform(spoofSize, fmtSize);
  const resting = useTransform(progress, [T.spikeIn[1], T.cancel[0]], [0, SPOOF_REST_SECONDS]);
  const restingText = useTransform(resting, (v) => `${v.toFixed(2)} s`);
  const bestAsk = useTransform(progress, (v) =>
    fmtPrice(v >= T.askLean ? heroAsks[heroAsks.length - 1].price - 0.01 : heroAsks[heroAsks.length - 1].price),
  );
  const spread = useTransform(progress, (v): string => (v >= T.askLean ? "0.01" : "0.02"));

  const rowRotate = useTransform(progress, [...T.rowFlip], [0, 180]);
  const badgeRotate = useTransform(progress, [...T.badgeFlip], [0, 180]);

  const idleCaption = useTransform(progress, [0, 0.04], [1, 0]);
  const holdCaption = useTransform(progress, [0.04, 0.08, 0.5, 0.56], [0, 1, 1, 0]);
  const alertCaption = useTransform(progress, [...T.caption], [0, 1]);

  return (
    <figure className="w-full">
      <figcaption className="sr-only">
        Sample order book for {SAMPLE_SYMBOL}. A bid for {SPOOF_SIZE.toLocaleString("en-US")} appears at
        the best bid, rests for {SPOOF_REST_SECONDS} seconds, and is canceled just before the best ask
        reaches it. Argus flags it: spoofed order canceled pre-execution.
      </figcaption>

      <div aria-hidden="true" className="border-y border-m-rule">
        <div className="flex h-11 items-center justify-between border-b border-m-rule">
          <p className="text-sm text-m-fg">
            Order book <span className="ml-2 font-mono tabular text-m-muted">{SAMPLE_SYMBOL}</span>
          </p>
          <div className="relative h-6 w-[5.75rem] [perspective:400px]">
            <motion.div
              className="relative h-full w-full [transform-style:preserve-3d]"
              style={{ rotateX: badgeRotate }}
            >
              <span className="absolute inset-0 flex items-center justify-center rounded-[2px] border border-m-rule text-xs text-m-muted [backface-visibility:hidden]">
                Watching
              </span>
              <span
                className="absolute inset-0 flex items-center justify-center rounded-[2px] font-mono text-xs font-semibold tracking-[0.04em] text-[#1A1614] [backface-visibility:hidden] [transform:rotateX(180deg)]"
                style={{ background: FLAT_GRADIENT }}
              >
                ALERT
              </span>
            </motion.div>
          </div>
        </div>

        <div className="grid h-8 grid-cols-[1fr_5.5rem_1fr] items-center text-xs text-m-muted">
          <span className="pr-3 text-right">Bid size</span>
          <span className="text-center">Price</span>
          <span className="pl-3">Ask size</span>
        </div>

        {heroAsks.map((level, i) => (
          <AskRow
            key={level.price}
            level={level}
            price={i === heroAsks.length - 1 ? bestAsk : undefined}
          />
        ))}

        <div className="grid h-7 grid-cols-[1fr_5.5rem_1fr] items-center border-y border-m-rule text-xs text-m-muted">
          <span />
          <span className="text-center">
            Spread <motion.span className="font-mono tabular text-m-fg">{spread}</motion.span>
          </span>
          <span />
        </div>

        {/* Best bid: the spoof lands here and flips once it's caught. */}
        <div className="relative h-7 [perspective:600px]">
          <motion.div
            className="relative h-full w-full [transform-style:preserve-3d]"
            style={{ rotateX: rowRotate }}
          >
            <div className="absolute inset-0 grid grid-cols-[1fr_5.5rem_1fr] items-center [backface-visibility:hidden]">
              <div className="relative flex h-full items-center justify-end pr-3">
                <span className="absolute inset-y-1 right-0 bg-[#E2D6C6]" style={{ width: barWidth(base) }} />
                <motion.span
                  className="absolute inset-y-1 right-0 w-full origin-right"
                  style={{ scaleX: spikeScale, background: BID_GRADIENT }}
                />
                <motion.span className="relative font-mono text-sm tabular text-m-fg">{spoofSizeText}</motion.span>
              </div>
              <span className="text-center font-mono text-sm tabular text-m-fg">{fmtPrice(heroBids[0].price)}</span>
              <span />
            </div>
            <div
              className="absolute inset-0 flex items-center px-3 text-sm text-[#1A1614] [backface-visibility:hidden] [transform:rotateX(180deg)]"
              style={{ background: FLAT_GRADIENT }}
            >
              <span className="font-medium">
                Bid <span className="font-mono tabular">{fmtPrice(heroBids[0].price)}</span> canceled after{" "}
                <span className="font-mono tabular">{SPOOF_REST_SECONDS.toFixed(2)} s</span>, 0 fills
              </span>
            </div>
          </motion.div>
        </div>

        {heroBids.slice(1).map((level) => (
          <BidRow key={level.price} level={level} />
        ))}
      </div>

      <div aria-hidden="true" className="relative mt-4 h-12 text-sm">
        <motion.p className="absolute inset-0 text-m-muted" style={{ opacity: idleCaption }}>
          Watching five levels each side of <span className="font-mono tabular">{SAMPLE_SYMBOL}</span>
        </motion.p>
        <motion.p className="absolute inset-0 text-m-muted" style={{ opacity: holdCaption }}>
          New bid for <span className="font-mono tabular text-m-fg">{SPOOF_SIZE.toLocaleString("en-US")}</span> at the
          touch, resting <motion.span className="font-mono tabular text-m-fg">{restingText}</motion.span>
        </motion.p>
        <motion.p className="absolute inset-0" style={{ opacity: alertCaption }}>
          <span className="block font-medium text-m-fg">Spoofed order canceled pre-execution</span>
          <span className="block text-m-muted">
            <span className="font-mono tabular">{(SPOOF_SIZE / base).toFixed(0)}x</span> the resting size at that
            level, pulled <span className="font-mono tabular">0.01</span> before the ask reached it
          </span>
        </motion.p>
      </div>
    </figure>
  );
}

function AskRow({ level, price }: { level: Level; price?: MotionValue<string> }) {
  return (
    <div className="grid h-7 grid-cols-[1fr_5.5rem_1fr] items-center">
      <span />
      <motion.span className="text-center font-mono text-sm tabular text-m-fg">
        {price ?? fmtPrice(level.price)}
      </motion.span>
      <div className="relative flex h-full items-center pl-3">
        <span
          className="absolute inset-y-1 left-0 border border-[#D6C9B8] bg-m-surface"
          style={{ width: barWidth(level.size) }}
        />
        <span className="relative font-mono text-sm tabular text-m-fg">{fmtSize(level.size)}</span>
      </div>
    </div>
  );
}

function BidRow({ level }: { level: Level }) {
  return (
    <div className="grid h-7 grid-cols-[1fr_5.5rem_1fr] items-center">
      <div className="relative flex h-full items-center justify-end pr-3">
        <span className="absolute inset-y-1 right-0 bg-[#E2D6C6]" style={{ width: barWidth(level.size) }} />
        <span className="relative font-mono text-sm tabular text-m-fg">{fmtSize(level.size)}</span>
      </div>
      <span className="text-center font-mono text-sm tabular text-m-fg">{fmtPrice(level.price)}</span>
      <span />
    </div>
  );
}
