import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BacktestResult } from "@/lib/backtest";
import { alertTypeLabel, fmtDateTime, fmtInt } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Panel } from "@/components/ui/Card";
import { Kpi } from "@/components/ui/StatChip";
import { Table, rowClass, thClass, theadRowClass } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { AlertsPerHourChart, LatencyChart, RULE_COLORS, RuleLegend } from "@/components/backtest/BacktestCharts";

export const metadata: Metadata = { title: "Backtest" };
export const dynamic = "force-dynamic";

const RESULT_FILE = path.join(process.cwd(), "data", "backtests", "latest.json");

async function loadLatest(): Promise<BacktestResult | null> {
  try {
    const parsed = JSON.parse(await readFile(RESULT_FILE, "utf8")) as BacktestResult;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

const pct = (v: number | null) => (v === null ? "–" : `${(v * 100).toFixed(1)}%`);
const secs = (ms: number | null | undefined) => (ms === null || ms === undefined ? "–" : `${(ms / 1000).toFixed(2)}s`);

export default async function BacktestPage() {
  const result = await loadLatest();

  if (!result) {
    return (
      <div>
        <PageHeader
          title="Backtest"
          description="Replays recorded Binance order flow through the surveillance engine with labelled manipulation patterns injected at known times, then scores the alerts."
        />
        <Panel title="No backtest result yet">
          <EmptyState
            title="Run a backtest to see results here"
            body={
              <>
                Record live data with <code className="num">npm run record</code>, then run{" "}
                <code className="num">npm run backtest</code>. The latest result is read from{" "}
                <code className="num">data/backtests/latest.json</code>.
              </>
            }
            actionHref={null}
          />
        </Panel>
      </div>
    );
  }

  const { config, replay, rules, episodes, dualModel } = result;
  const injected = rules.reduce((n, r) => n + r.injected, 0);
  const detected = rules.reduce((n, r) => n + r.detected, 0);
  const totalAlerts = rules.reduce((n, r) => n + r.alerts, 0);
  const tp = rules.reduce((n, r) => n + r.truePositives, 0);
  const latencies = episodes.filter((e) => e.detected).map((e) => e.latencyMs ?? 0).sort((a, b) => a - b);
  const medianLatency = latencies.length ? latencies[Math.floor((latencies.length - 1) / 2)] : null;

  return (
    <div>
      <PageHeader
        title="Backtest"
        eyebrow={`Run ${result.runId} · ${fmtDateTime(result.generatedAt)}`}
        description={`${config.symbols.join(", ")} from ${fmtDateTime(config.from)} to ${fmtDateTime(config.to)} (${result.dataHours.toFixed(2)}h). Recorded Binance order flow replayed through the live engine rules with ${config.injectionsPerRule} labelled injections per rule per symbol at ${config.intensity}x threshold intensity.`}
      />

      <div className="stagger grid gap-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="Events replayed" value={fmtInt(replay.evaluated)} sub={`${fmtInt(replay.injectedEvents)} injected`} />
          <Kpi label="Recall" value={pct(injected ? detected / injected : null)} sub={`${detected} of ${injected} episodes`} />
          <Kpi label="Precision" value={pct(totalAlerts ? tp / totalAlerts : null)} sub={`${tp} of ${totalAlerts} alerts`} />
          <Kpi label="Median latency" value={secs(medianLatency)} sub="event time" />
          <Kpi
            label="Model agreement"
            value={pct(dualModel.agreementRate)}
            sub={config.ai ? `${dualModel.agreed} of ${dualModel.bothAnswered} paired runs` : "AI disabled"}
          />
          <Kpi
            label="Replay speed"
            value={replay.effectiveSpeed ? `${replay.effectiveSpeed.toFixed(1)}x` : "–"}
            sub={`${(replay.wallMs / 1000).toFixed(0)}s wall · ${replay.engineErrors} errors`}
          />
        </div>

        <Panel n={1} title="Per rule" meta={`match window: episode start to end + ${config.matchWindowMs / 1000}s`}>
          <div className="overflow-x-auto px-2 pb-2">
            <Table caption="Precision, recall and detection latency per rule">
              <thead>
                <tr className={theadRowClass}>
                  <th className={`${thClass} text-left`}>Rule</th>
                  <th className={`${thClass} text-right`}>Injected</th>
                  <th className={`${thClass} text-right`}>Detected</th>
                  <th className={`${thClass} text-right`}>Recall</th>
                  <th className={`${thClass} text-right`}>Alerts</th>
                  <th className={`${thClass} text-right`}>Matched</th>
                  <th className={`${thClass} text-right`}>Unmatched</th>
                  <th className={`${thClass} text-right`}>Precision</th>
                  <th className={`${thClass} text-right`}>Unmatched / symbol-h</th>
                  <th className={`${thClass} text-right`}>Latency p50</th>
                  <th className={`${thClass} text-right`}>p95</th>
                  <th className={`${thClass} text-right`}>Max</th>
                  <th className={`${thClass} text-left`}>Verdicts</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.rule} className={rowClass}>
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: RULE_COLORS[r.rule] }} />
                        {alertTypeLabel(r.rule)}
                      </span>
                    </td>
                    <td className="num px-2 py-1.5 text-right">{r.injected}</td>
                    <td className="num px-2 py-1.5 text-right">{r.detected}</td>
                    <td className="num px-2 py-1.5 text-right">{pct(r.recall)}</td>
                    <td className="num px-2 py-1.5 text-right">{r.alerts}</td>
                    <td className="num px-2 py-1.5 text-right">{r.truePositives}</td>
                    <td className="num px-2 py-1.5 text-right">{r.falsePositives}</td>
                    <td className="num px-2 py-1.5 text-right">{pct(r.precision)}</td>
                    <td className="num px-2 py-1.5 text-right">{r.falsePositivesPerHour === null ? "–" : r.falsePositivesPerHour.toFixed(1)}</td>
                    <td className="num px-2 py-1.5 text-right">{secs(r.latencyMs?.median)}</td>
                    <td className="num px-2 py-1.5 text-right">{secs(r.latencyMs?.p95)}</td>
                    <td className="num px-2 py-1.5 text-right">{secs(r.latencyMs?.max)}</td>
                    <td className="num px-2 py-1.5 text-dim">
                      {Object.entries(r.verdicts).map(([v, n]) => `${v} ${n}`).join(" · ") || "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="px-2 pt-2 text-[12px] leading-[18px] text-dim">
              Unmatched alerts fired on recorded market data outside any injected episode. Real order flow can contain genuine
              manipulation, so precision here is a lower bound.
            </p>
          </div>
        </Panel>

        <div className="grid gap-4 xl:grid-cols-2">
          <Panel n={2} title="Alerts per symbol-hour" meta="saved alerts, UTC" actions={<RuleLegend />} bodyClassName="p-4">
            <AlertsPerHourChart rows={result.alertsPerSymbolHour} />
          </Panel>
          <Panel n={3} title="Detection latency" meta="per injected episode" actions={<RuleLegend />} bodyClassName="p-4">
            <LatencyChart episodes={episodes} windowMs={config.matchWindowMs} />
          </Panel>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_2fr]">
          <Panel n={4} title="Dual-model check" meta="gray-zone imbalance only" bodyClassName="p-4">
            {dualModel.runs === 0 ? (
              <p className="text-[13px] text-dim">No gray-zone cases reached the models in this run.</p>
            ) : (
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[13px]">
                {Object.entries(dualModel.outcomes)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-dim">{k.replace(/_/g, " ")}</dt>
                      <dd className="num text-right">{v}</dd>
                    </div>
                  ))}
                <dt className="border-t border-seam pt-1 font-medium">Agreement rate</dt>
                <dd className="num border-t border-seam pt-1 text-right font-medium">{pct(dualModel.agreementRate)}</dd>
              </dl>
            )}
          </Panel>

          <Panel n={5} title="Injected episodes" meta={`${episodes.length} labelled`}>
            <div className="max-h-[28rem] overflow-auto px-2 pb-2">
              <Table caption="Injected episodes and whether each was detected">
                <thead>
                  <tr className={theadRowClass}>
                    <th className={`${thClass} text-left`}>Episode</th>
                    <th className={`${thClass} text-left`}>Start (UTC)</th>
                    <th className={`${thClass} text-left`}>Pattern</th>
                    <th className={`${thClass} text-left`}>Result</th>
                    <th className={`${thClass} text-right`}>Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {episodes.map((e) => (
                    <tr key={e.id} className={rowClass}>
                      <td className="num whitespace-nowrap px-2 py-1.5">{e.id}</td>
                      <td className="num whitespace-nowrap px-2 py-1.5">{e.start.slice(11, 19)}</td>
                      <td className="px-2 py-1.5 text-dim">{e.detail}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {e.detected ? `● Detected (${e.firstVerdict})` : "○ Missed"}
                      </td>
                      <td className="num px-2 py-1.5 text-right">{secs(e.latencyMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
