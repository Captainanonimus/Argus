"use client";

import type { ReactNode } from "react";
import { motion, useMotionTemplate, useTransform, type MotionValue } from "framer-motion";
import {
  candles,
  depthAsks,
  depthBids,
  LAST_PRICE,
  SAMPLE_SYMBOL,
  sessionChange,
  timeTicks,
  type Level,
} from "@/lib/sample-market";

const COMMAND = "ARGUS <GO>";

// Boot timeline, as fractions of `boot` (0..1):
//   0.00-0.40  panel borders draw in, one panel after another
//   0.22-0.42  command line types ARGUS <GO>
//   0.42-0.72  depth bars grow from zero, outward from the spread
//   0.55-0.95  candles draw left to right
const PANEL_STAGGER = 0.05;
const PANEL_DRAW = 0.22;

type Props = {
  /** 0..1 boot position. Pass a constant 1 to render the booted workspace. */
  boot: MotionValue<number>;
};

export function TerminalWorkspace({ boot }: Props) {
  const typedCount = useTransform(boot, [0.22, 0.42], [0, COMMAND.length]);
  const typed = useTransform(typedCount, (c) => COMMAND.slice(0, Math.floor(c)));
  const frameEdge = useTransform(boot, [0, PANEL_DRAW], [0, 1]);

  return (
    <div className="relative bg-ink font-sans text-text" role="img" aria-label={`Sample Argus workspace for ${SAMPLE_SYMBOL}: order book depth, price chart and alert queue`}>
      {/* Frame draws its own top and left edges; panels draw right and bottom so every seam is 1px. */}
      <motion.span className="absolute inset-x-0 top-0 h-px origin-left bg-seam" style={{ scaleX: frameEdge }} />
      <motion.span className="absolute inset-y-0 left-0 w-px origin-top bg-seam" style={{ scaleY: frameEdge }} />

      <Panel boot={boot} index={0} className="h-10">
        <div className="flex h-full items-center justify-between gap-4 px-3">
          <p className="flex items-center gap-2 font-mono text-[13px]">
            <span className="text-dim">&gt;</span>
            <motion.span>{typed}</motion.span>
            <span className="inline-block h-4 w-2 bg-text/70" />
          </p>
          <p className="hidden items-center gap-4 font-mono text-[13px] tabular sm:flex">
            <span>{SAMPLE_SYMBOL}</span>
            <span>{LAST_PRICE.toFixed(2)}</span>
            <span className={sessionChange >= 0 ? "text-bid" : "text-ask"}>
              {sessionChange >= 0 ? `+${sessionChange.toFixed(2)} ▲` : `${sessionChange.toFixed(2)} ▼`}
            </span>
          </p>
        </div>
      </Panel>

      <div className="grid lg:grid-cols-12">
        <Panel boot={boot} index={1} title="Order book" meta={`${SAMPLE_SYMBOL}, 8 levels`} className="lg:col-span-4">
          <DepthLadder boot={boot} />
        </Panel>
        <Panel boot={boot} index={2} title="Price" meta="1 min, sample session" className="lg:col-span-8">
          <CandleChart boot={boot} />
        </Panel>
      </div>

      <Panel boot={boot} index={3} title="Alert queue" meta="1 open">
        <div className="p-2">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-4 gap-y-1 rounded-[2px] px-2 py-1.5 outline outline-1 -outline-offset-1 outline-alert sm:grid-cols-[auto_auto_1fr_auto_auto]">
            <span className="font-mono text-[11px] tabular text-dim">14:32:05.118</span>
            <span className="text-[13px]">Spoofing, bid side</span>
            <span className="hidden font-mono text-[13px] tabular sm:inline">{SAMPLE_SYMBOL} 48,000 @ 101.24</span>
            <span className="hidden text-[13px] text-dim sm:inline">2 of 2 models agree</span>
            <span className="rounded-[2px] bg-alert px-1.5 py-0.5 text-[11px] font-semibold text-ink">High</span>
          </div>
        </div>
      </Panel>

      <Panel boot={boot} index={4} className="h-6">
        <div className="flex h-full items-center gap-4 px-3 font-mono text-[11px] tabular text-dim">
          <span>Connected</span>
          <span>Feed 3 ms</span>
          <span className="hidden sm:inline">Sample data</span>
          <span className="ml-auto">14:32:07 UTC</span>
        </div>
      </Panel>
    </div>
  );
}

function Panel({
  boot,
  index,
  title,
  meta,
  className = "",
  children,
}: {
  boot: MotionValue<number>;
  index: number;
  title?: string;
  meta?: string;
  className?: string;
  children: ReactNode;
}) {
  const start = index * PANEL_STAGGER;
  const end = start + PANEL_DRAW;
  const edge = useTransform(boot, [start, end], [0, 1]);
  const content = useTransform(boot, [end - 0.06, end + 0.04], [0, 1]);

  return (
    <section className={`relative bg-panel ${className}`}>
      <motion.span className="absolute inset-x-0 bottom-0 h-px origin-left bg-seam" style={{ scaleX: edge }} />
      <motion.span className="absolute inset-y-0 right-0 w-px origin-top bg-seam" style={{ scaleY: edge }} />
      <motion.div className="h-full" style={{ opacity: content }}>
        {title && (
          <header className="flex h-7 items-center justify-between border-b border-seam px-2">
            <h4 className="text-[13px] font-semibold">{title}</h4>
            {meta && <span className="text-[11px] text-dim">{meta}</span>}
          </header>
        )}
        {children}
      </motion.div>
    </section>
  );
}

const DEPTH_REFERENCE = 5600;

function DepthLadder({ boot }: { boot: MotionValue<number> }) {
  return (
    <div className="py-1 font-mono text-[13px] tabular">
      <div className="grid h-6 grid-cols-[4.5rem_4rem_1fr] items-center px-2 font-sans text-[11px] text-dim">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span />
      </div>
      {depthAsks.map((level, i) => (
        <DepthRow key={level.price} level={level} side="ask" distance={depthAsks.length - 1 - i} boot={boot} />
      ))}
      <div className="flex h-6 items-center justify-between border-y border-seam px-2 font-sans text-[11px] text-dim">
        <span>Spread</span>
        <span className="font-mono tabular text-text">0.02</span>
      </div>
      {depthBids.map((level, i) => (
        <DepthRow key={level.price} level={level} side="bid" distance={i} boot={boot} />
      ))}
    </div>
  );
}

function DepthRow({
  level,
  side,
  distance,
  boot,
}: {
  level: Level;
  side: "bid" | "ask";
  distance: number;
  boot: MotionValue<number>;
}) {
  const start = 0.42 + distance * 0.025;
  const grow = useTransform(boot, [start, start + 0.12], [0, 1]);
  const width = `${Math.min(100, (level.size / DEPTH_REFERENCE) * 100)}%`;

  return (
    <div className="grid h-6 grid-cols-[4.5rem_4rem_1fr] items-center px-2">
      <span className={side === "bid" ? "text-bid" : "text-ask"}>{level.price.toFixed(2)}</span>
      <span className="text-right">{level.size.toLocaleString("en-US")}</span>
      <div className="relative ml-3 h-3.5">
        <motion.span
          className={`absolute inset-y-0 left-0 origin-left ${side === "bid" ? "bg-bid/25" : "bg-ask/25"}`}
          style={{ width, scaleX: grow }}
        />
      </div>
    </div>
  );
}

const CHART_W = 640;
const CHART_H = 240;
const VOLUME_H = 44;

function CandleChart({ boot }: { boot: MotionValue<number> }) {
  const reveal = useTransform(boot, [0.55, 0.95], [100, 0]);
  const clip = useMotionTemplate`inset(0 ${reveal}% 0 0)`;

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const max = Math.max(...highs) + 0.01;
  const min = Math.min(...lows) - 0.01;
  const maxVol = Math.max(...candles.map((c) => c.volume));
  const priceH = CHART_H - VOLUME_H - 8;
  const y = (p: number) => ((max - p) / (max - min)) * priceH;
  const step = CHART_W / candles.length;
  const body = step * 0.62;
  const last = candles[candles.length - 1].close;
  const ticks = Array.from({ length: 5 }, (_, i) => max - ((max - min) * (i + 0.5)) / 5);

  return (
    <div className="grid grid-cols-[1fr_3.75rem] grid-rows-[1fr_1.5rem]">
      <div className="relative h-[220px] sm:h-[280px] lg:h-[300px]">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          {ticks.map((t) => (
            <line key={t} x1={0} x2={CHART_W} y1={y(t)} y2={y(t)} stroke="#232833" vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
        <motion.svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
          style={{ clipPath: clip }}
        >
          {candles.map((c, i) => {
            const up = c.close >= c.open;
            const cx = i * step + step / 2;
            const top = y(Math.max(c.open, c.close));
            const h = Math.max(1, Math.abs(y(c.open) - y(c.close)));
            const color = up ? "#2FBF71" : "#E5484D";
            const volH = (c.volume / maxVol) * VOLUME_H;
            return (
              <g key={i}>
                <line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} stroke={color} vectorEffect="non-scaling-stroke" />
                <rect
                  x={cx - body / 2}
                  y={top}
                  width={body}
                  height={h}
                  fill={up ? "#12151C" : color}
                  stroke={color}
                  vectorEffect="non-scaling-stroke"
                />
                <rect x={cx - body / 2} y={CHART_H - volH} width={body} height={volH} fill={color} opacity={0.4} />
              </g>
            );
          })}
          <line
            x1={0}
            x2={CHART_W}
            y1={y(last)}
            y2={y(last)}
            stroke="#FFA028"
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        </motion.svg>
      </div>

      {/* Price axis: amber is chart chrome only. */}
      <div className="relative border-l border-seam font-mono text-[11px] tabular text-chart">
        <div className="absolute inset-x-0 top-0" style={{ height: `${(priceH / CHART_H) * 100}%` }}>
          {ticks.map((t) => (
            <span
              key={t}
              className="absolute left-1.5 -translate-y-1/2"
              style={{ top: `${(y(t) / priceH) * 100}%` }}
            >
              {t.toFixed(2)}
            </span>
          ))}
          <span
            className="absolute inset-x-0 -translate-y-1/2 bg-chart px-1.5 font-medium text-ink"
            style={{ top: `${(y(last) / priceH) * 100}%` }}
          >
            {last.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-seam px-2 font-mono text-[11px] tabular text-chart">
        {timeTicks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="border-l border-t border-seam" />
    </div>
  );
}
