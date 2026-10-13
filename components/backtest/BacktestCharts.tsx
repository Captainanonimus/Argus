"use client";

import { useState } from "react";
import type { Episode, SymbolHour } from "@/lib/backtest";
import { alertTypeLabel } from "@/lib/format";

// Fixed categorical order: one hue per rule, validated on the parchment
// panel (CVD ΔE >= 9). Each chart has a legend and a table view on the page,
// so identity never rests on colour alone.
export const RULE_COLORS: Record<string, string> = {
  quote_stuffing: "#2a78d6",
  spoofing: "#eb6834",
  book_imbalance: "#1baf7a",
};
const RULES = Object.keys(RULE_COLORS);

export function RuleLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-dim">
      {RULES.map((r) => (
        <li key={r} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: RULE_COLORS[r] }} />
          {alertTypeLabel(r)}
        </li>
      ))}
    </ul>
  );
}

type Tip = { x: number; y: number; lines: string[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[2px] border border-seam bg-ink px-2 py-1.5 text-[11px] leading-4 text-text shadow-sm"
      style={{ left: tip.x, top: tip.y - 8 }}
    >
      {tip.lines.map((l, i) => (
        <p key={i} className={i === 0 ? "font-medium" : "num text-dim"}>
          {l}
        </p>
      ))}
    </div>
  );
}

const hourLabel = (iso: string) => `${iso.slice(11, 13)}:00`;

// Stacked bars of saved alerts per UTC hour, one small multiple per symbol
// on a shared y-scale.
export function AlertsPerHourChart({ rows }: { rows: SymbolHour[] }) {
  const [tip, setTip] = useState<Tip>(null);
  const symbols = Array.from(new Set(rows.map((r) => r.symbol)));
  const max = Math.max(1, ...rows.map((r) => r.total));
  const H = 140;
  const PAD_L = 28;
  const PAD_B = 18;
  const plotH = H - PAD_B - 6;

  return (
    <div className="relative grid gap-4 sm:grid-cols-2" onMouseLeave={() => setTip(null)}>
      {symbols.map((symbol) => {
        const series = rows.filter((r) => r.symbol === symbol);
        const W = 360;
        const slot = (W - PAD_L) / Math.max(series.length, 1);
        const barW = Math.max(3, Math.min(28, slot - 2));
        const labelEvery = Math.ceil(series.length / 8);
        return (
          <figure key={symbol} className="relative min-w-0">
            <figcaption className="mb-1 text-[12px] font-medium text-text">{symbol}</figcaption>
            <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label={`Alerts per hour for ${symbol}`}>
              {[0, 0.5, 1].map((f) => {
                const y = 6 + plotH * (1 - f);
                return (
                  <g key={f}>
                    <line x1={PAD_L} x2={W} y1={y} y2={y} className="stroke-seam" strokeWidth={1} />
                    <text x={PAD_L - 4} y={y + 3} textAnchor="end" className="fill-dim font-mono text-[9px]">
                      {Math.round(max * f)}
                    </text>
                  </g>
                );
              })}
              {series.map((r, i) => {
                const x = PAD_L + i * slot + (slot - barW) / 2;
                let y = 6 + plotH;
                return (
                  <g
                    key={r.hour}
                    onMouseMove={(e) => {
                      const box = (e.currentTarget.ownerSVGElement?.parentElement?.parentElement as HTMLElement).getBoundingClientRect();
                      setTip({
                        x: e.clientX - box.left,
                        y: e.clientY - box.top,
                        lines: [
                          `${symbol} ${r.hour.slice(0, 10)} ${hourLabel(r.hour)} UTC`,
                          ...RULES.map((t) => `${alertTypeLabel(t)}: ${r.counts[t as keyof typeof r.counts]}`),
                          `Not matched to an injection: ${r.falsePositives}`,
                        ],
                      });
                    }}
                  >
                    {/* Hit target covers the full column. */}
                    <rect x={PAD_L + i * slot} y={0} width={slot} height={6 + plotH} fill="transparent" />
                    {RULES.map((t) => {
                      const v = r.counts[t as keyof typeof r.counts];
                      if (!v) return null;
                      const h = (v / max) * plotH;
                      y -= h;
                      return (
                        <rect
                          key={t}
                          x={x}
                          y={y}
                          width={barW}
                          height={Math.max(h - 2, 1)}
                          rx={1}
                          fill={RULE_COLORS[t]}
                        />
                      );
                    })}
                    {i % labelEvery === 0 && (
                      <text x={x + barW / 2} y={H - 4} textAnchor="middle" className="fill-dim font-mono text-[9px]">
                        {hourLabel(r.hour)}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </figure>
        );
      })}
      <Tooltip tip={tip} />
    </div>
  );
}

// One row per rule: a dot per detected episode at its latency; missed
// episodes sit in a separate "missed" column as hollow marks.
export function LatencyChart({ episodes, windowMs }: { episodes: Episode[]; windowMs: number }) {
  const [tip, setTip] = useState<Tip>(null);
  const W = 560;
  const ROW = 34;
  const PAD_L = 112;
  const MISS_W = 56;
  const plotW = W - PAD_L - MISS_W - 12;
  const H = RULES.length * ROW + 24;
  const maxS = windowMs / 1000;
  const ticks = [0, maxS / 4, maxS / 2, (3 * maxS) / 4, maxS];
  const xOf = (ms: number) => PAD_L + (Math.min(ms, windowMs) / windowMs) * plotW;

  const show = (e: React.MouseEvent<SVGCircleElement>, ep: Episode) => {
    const box = (e.currentTarget.ownerSVGElement?.parentElement as HTMLElement).getBoundingClientRect();
    setTip({
      x: e.clientX - box.left,
      y: e.clientY - box.top,
      lines: [
        ep.id,
        ep.detected ? `Detected after ${((ep.latencyMs ?? 0) / 1000).toFixed(2)}s (${ep.firstVerdict})` : "Not detected",
        `Injected ${ep.start.slice(11, 19)} UTC`,
      ],
    });
  };

  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full overflow-visible" role="img" aria-label="Detection latency per injected episode">
        {ticks.map((s) => (
          <g key={s}>
            <line x1={xOf(s * 1000)} x2={xOf(s * 1000)} y1={0} y2={RULES.length * ROW} className="stroke-seam" strokeWidth={1} />
            <text x={xOf(s * 1000)} y={H - 6} textAnchor="middle" className="fill-dim font-mono text-[9px]">
              {s}s
            </text>
          </g>
        ))}
        <text x={W - MISS_W / 2 - 6} y={H - 6} textAnchor="middle" className="fill-dim text-[9px]">
          missed
        </text>
        {RULES.map((rule, row) => {
          const cy = row * ROW + ROW / 2;
          const eps = episodes.filter((e) => e.rule === rule);
          const missed = eps.filter((e) => !e.detected);
          return (
            <g key={rule}>
              <text x={0} y={cy + 4} className="fill-text text-[11px]">
                {alertTypeLabel(rule)}
              </text>
              {eps
                .filter((e) => e.detected)
                .map((e) => (
                  <circle
                    key={e.id}
                    cx={xOf(e.latencyMs ?? 0)}
                    cy={cy}
                    r={5}
                    fill={RULE_COLORS[rule]}
                    className="stroke-panel"
                    strokeWidth={2}
                    onMouseMove={(ev) => show(ev, e)}
                  />
                ))}
              {missed.map((e, i) => (
                <circle
                  key={e.id}
                  cx={W - MISS_W - 6 + 12 + i * 12}
                  cy={cy}
                  r={4.5}
                  fill="none"
                  stroke={RULE_COLORS[rule]}
                  strokeWidth={2}
                  onMouseMove={(ev) => show(ev, e)}
                />
              ))}
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}
