"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowSquareOut, Play, Stop, Trash } from "@phosphor-icons/react";
import type { AlertType, Verdict } from "@/lib/eventTypes";
import { ApiError, errorMessage, fetchJson, isAbortError, type IngestResponse } from "@/lib/clientApi";
import { SCENARIOS, scenarioDurationMs, type ScenarioDef, type ScenarioEvent } from "@/lib/scenarios";
import { alertTypeLabel, fmtInt, fmtPrice, fmtTimeMs } from "@/lib/format";
import { normalizeTicker } from "@/components/app/ticker";
import { Button, ErrorState, Label, Panel, PageHeader, SideTag, VerdictBadge, buttonClass, inputClass } from "@/components/app/ui";

const DEFAULT_SYMBOL = "SIM1";
const SIM_SYMBOLS = ["SIM1", "SIM2", "SIM3", "SIM4", "SIM5"];
const LOG_MAX = 300;
const MAX_CONSECUTIVE_ERRORS = 3;

type LogRow = {
  i: number;
  ev: ScenarioEvent;
  at: string;
  verdict: Verdict | null;
  alertTypes: AlertType[];
  reason: string;
  error?: string;
};

type Run = {
  scenario: ScenarioDef;
  symbol: string;
  total: number;
  sent: number;
  durationMs: number;
  startedAt: number;
  counts: Record<Verdict, number>;
  errors: number;
  fired: AlertType[];
  lagMs: number;
  state: "resetting" | "running" | "done" | "stopped" | "failed";
  message?: string;
};

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function outcome(run: Run): { ok: boolean; text: string } {
  const s = run.scenario;
  if (s.expectedAlert === null) {
    const quiet = run.counts.FLAG === 0 && run.counts.REVIEW === 0;
    return quiet
      ? { ok: true, text: "As expected: every event came back CLEAR." }
      : { ok: false, text: "Something fired during normal flow. Older events on this symbol are probably still inside the engine's windows; reset simulated data and run again." };
  }
  if (run.fired.includes(s.expectedAlert)) {
    return { ok: true, text: `As expected: the ${alertTypeLabel(s.expectedAlert).toLowerCase()} rule fired.` };
  }
  if (s.id === "gray_zone" && run.counts.CLEAR === run.sent - run.errors) {
    return { ok: true, text: "The gray-zone check ran and the models judged it CLEAR, so no alert was saved." };
  }
  return { ok: false, text: "The expected rule did not fire. Reset simulated data (the windows look back up to 5 minutes) and run again." };
}

export function Simulator() {
  const params = useSearchParams();
  const initial = normalizeTicker(params?.get("symbol") ?? "") ?? DEFAULT_SYMBOL;
  const [symbolInput, setSymbolInput] = useState(initial);
  const symbol = normalizeTicker(symbolInput);
  const isSim = !!symbol && symbol.startsWith("SIM");
  const [clearFirst, setClearFirst] = useState(true);

  const [run, setRun] = useState<Run | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [resetErr, setResetErr] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const running = run?.state === "running" || run?.state === "resetting";

  // Stop on unmount; warn before leaving mid-run.
  useEffect(() => () => controllerRef.current?.abort(), []);
  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const resetData = useCallback(async () => {
    const r = await fetchJson<{ deleted: { events: number; alerts: number } }>("/api/demo/reset", { method: "POST" });
    return r.deleted;
  }, []);

  const start = async (scenario: ScenarioDef) => {
    if (!symbol || running) return;
    const events = scenario.generate(symbol);
    const controller = new AbortController();
    controllerRef.current = controller;
    const signal = controller.signal;
    setLog([]);
    setResetMsg(null);
    const base: Run = {
      scenario,
      symbol,
      total: events.length,
      sent: 0,
      durationMs: scenarioDurationMs(events),
      startedAt: Date.now(),
      counts: { CLEAR: 0, REVIEW: 0, FLAG: 0 },
      errors: 0,
      fired: [],
      lagMs: 0,
      state: clearFirst && isSim ? "resetting" : "running",
    };
    setRun(base);

    try {
      if (clearFirst && isSim) {
        const d = await resetData();
        setResetMsg(`Cleared ${fmtInt(d.events)} simulated events and ${fmtInt(d.alerts)} alerts before the run.`);
      }
      const t0 = Date.now();
      setRun((r) => r && { ...r, state: "running", startedAt: t0 });

      let consecutive = 0;
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const due = t0 + ev.at;
        const wait = due - Date.now();
        if (wait > 0) await sleep(wait, signal);
        const lag = Math.max(0, Date.now() - due);
        const createdAt = new Date(due).toISOString();
        const row: LogRow = { i, ev, at: createdAt, verdict: null, alertTypes: [], reason: "" };
        try {
          const res = await fetchJson<IngestResponse>("/api/events", {
            method: "POST",
            body: JSON.stringify({
              symbol,
              accountId: ev.accountId,
              side: ev.side,
              eventType: ev.eventType,
              price: ev.price,
              size: ev.size,
              createdAt,
            }),
            signal,
          });
          consecutive = 0;
          row.verdict = res.verdict;
          row.alertTypes = res.alertTypes;
          row.reason = res.reason;
          setRun((r) =>
            r && {
              ...r,
              sent: i + 1,
              lagMs: lag,
              counts: { ...r.counts, [res.verdict]: r.counts[res.verdict] + 1 },
              fired: Array.from(new Set([...r.fired, ...res.alertTypes])),
            },
          );
        } catch (err) {
          if (isAbortError(err)) throw err;
          consecutive++;
          row.error = errorMessage(err);
          setRun((r) => r && { ...r, sent: i + 1, errors: r.errors + 1, lagMs: lag });
          if (err instanceof ApiError && err.status === 400) {
            throw new Error(`The server rejected an event: ${errorMessage(err)} Check that this computer's clock is correct.`);
          }
          if (consecutive >= MAX_CONSECUTIVE_ERRORS) {
            throw new Error(`Stopped after ${MAX_CONSECUTIVE_ERRORS} failed requests in a row: ${errorMessage(err)}`);
          }
        }
        setLog((l) => [row, ...l].slice(0, LOG_MAX));
      }
      setRun((r) => r && { ...r, state: "done" });
    } catch (err) {
      if (isAbortError(err)) setRun((r) => r && { ...r, state: "stopped" });
      else setRun((r) => r && { ...r, state: "failed", message: errorMessage(err) });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const stop = () => controllerRef.current?.abort();

  const manualReset = async () => {
    if (!window.confirm("Delete all simulated events and alerts (symbols starting with SIM)? Other symbols are not touched.")) return;
    setResetting(true);
    setResetErr(null);
    setResetMsg(null);
    try {
      const d = await resetData();
      setResetMsg(`Deleted ${fmtInt(d.events)} simulated events and ${fmtInt(d.alerts)} alerts.`);
    } catch (err) {
      setResetErr(`Reset failed: ${errorMessage(err)}`);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div>
      <PageHeader title="Simulator" description="Stream a scripted scenario through the real surveillance engine and watch each verdict come back. Simulated symbols start with SIM.">
        <Button size="sm" variant="danger" onClick={manualReset} disabled={running || resetting}>
          <Trash size={14} aria-hidden="true" />
          {resetting ? "Resetting" : "Reset simulated data"}
        </Button>
      </PageHeader>

      <div className="stagger grid gap-4 lg:grid-cols-12">
        <Panel n={1} title="Setup" className="lg:col-span-4" bodyClassName="space-y-3 p-4">
          <div>
            <Label htmlFor="sim-symbol">Symbol</Label>
            <input
              id="sim-symbol"
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
              list="sim-symbols"
              maxLength={16}
              disabled={running}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={!symbol}
              aria-describedby="sim-symbol-help"
              className={`${inputClass} font-mono uppercase`}
            />
            <datalist id="sim-symbols">
              {SIM_SYMBOLS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <p id="sim-symbol-help" className="mt-1 text-[12px] leading-4 text-dim">
              {!symbol
                ? "Enter 1 to 16 characters: A-Z, 0-9, '.', '_' or '-'."
                : isSim
                  ? "Simulated symbols start with SIM and can be cleared with Reset."
                  : `${symbol} does not start with SIM, so Reset will not remove these events.`}
            </p>
          </div>
          <label className="flex items-start gap-2 text-[13px] leading-[18px]">
            <input
              type="checkbox"
              checked={clearFirst && isSim}
              disabled={!isSim || running}
              onChange={(e) => setClearFirst(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#1A1614]"
            />
            <span>
              Clear simulated data before each run
              <span className="block text-[12px] text-dim">
                Recommended. The rules look back 60 seconds to 5 minutes, so leftovers from an earlier run can change the result.
              </span>
            </span>
          </label>
          <p className="text-[12px] leading-4 text-dim">
            Events are sent from this browser one at a time, at the scenario&apos;s pace. Keep this tab open while it runs.
          </p>
          {symbol && (
            <Link
              href={`/dashboard?symbol=${encodeURIComponent(symbol)}`}
              target="_blank"
              rel="noopener"
              className={buttonClass("secondary", "sm")}
            >
              <ArrowSquareOut size={14} aria-hidden="true" />
              Watch {symbol} on the dashboard
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>
          )}
          {resetMsg && <p role="status" className="text-[12px] text-text">{resetMsg}</p>}
          {resetErr && <ErrorState compact message={resetErr} />}
        </Panel>

        <Panel n={2} title="Scenarios" meta="each one is tuned to the engine's real thresholds" className="lg:col-span-8">
          <ol>
            {SCENARIOS.map((s, idx) => {
              const active = run?.scenario.id === s.id && running;
              return (
                <li key={s.id} className={`grid gap-3 border-b border-seam px-3 py-3 sm:grid-cols-[1fr_auto] ${active ? "bg-panelhi" : ""}`}>
                  <div className="min-w-0">
                    <h3 className="flex items-baseline gap-2 text-[14px] font-semibold">
                      <span className="num text-[11px] text-dim">{String(idx + 1).padStart(2, "0")}</span>
                      {s.name}
                    </h3>
                    <p className="mt-0.5 text-[13px] leading-[18px] text-text">{s.summary}</p>
                    <p className="mt-0.5 text-[12px] leading-4 text-dim">
                      <span className="font-medium">Expected:</span> {s.expected}
                    </p>
                  </div>
                  <div className="flex items-start gap-2">
                    {active ? (
                      <Button variant="danger" onClick={stop}>
                        <Stop size={14} aria-hidden="true" />
                        Stop
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        disabled={running || !symbol}
                        onClick={() => start(s)}
                        aria-label={`Run ${s.name} on ${symbol ?? "the chosen symbol"}`}
                      >
                        <Play size={14} aria-hidden="true" />
                        Run
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </Panel>

        <Panel n={3} title="Run" className="lg:col-span-4" bodyClassName="p-4">
          {run ? <RunStatus run={run} onStop={stop} /> : <p className="text-[13px] text-dim">Choose a scenario and press Run. Progress and verdicts appear here.</p>}
        </Panel>

        <Panel n={4} tone="terminal" title="Verdicts as they arrive" meta={log.length ? `${log.length} shown, newest first` : undefined} className="h-[420px] lg:col-span-8" bodyClassName="overflow-auto">
          {log.length === 0 ? (
            <p className="p-3 text-[13px] text-dim">No events sent yet.</p>
          ) : (
            <table className="w-full min-w-[640px] text-[12px]">
              <caption className="sr-only">Events sent in this run, newest first, with the engine&apos;s verdict</caption>
              <thead className="sticky top-0 bg-panel">
                <tr className="border-b border-seam text-[11px] text-dim">
                  <th scope="col" className="px-2 py-1 text-right font-medium">#</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Time</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Event</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Side</th>
                  <th scope="col" className="px-2 py-1 text-right font-medium">Size @ price</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Account</th>
                  <th scope="col" className="px-2 py-1 text-left font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.i} className={`border-b border-seam/50 align-top ${r.verdict === "FLAG" ? "outline outline-1 -outline-offset-1 outline-alert" : ""}`}>
                    <td className="num px-2 py-0.5 text-right text-dim">{r.i + 1}</td>
                    <td className="num whitespace-nowrap px-2 py-0.5 text-[11px] text-dim">{fmtTimeMs(r.at)}</td>
                    <td className="px-2 py-0.5">
                      {r.ev.eventType}
                      {r.ev.note && <span className="block text-[11px] text-dim">{r.ev.note}</span>}
                    </td>
                    <td className="px-2 py-0.5"><SideTag side={r.ev.side} /></td>
                    <td className="num whitespace-nowrap px-2 py-0.5 text-right">{fmtInt(r.ev.size)} @ {fmtPrice(r.ev.price)}</td>
                    <td className="num px-2 py-0.5 text-dim">{r.ev.accountId}</td>
                    <td className="px-2 py-0.5">
                      {r.error ? (
                        <span className="text-[12px] text-text">
                          <span aria-hidden="true">× </span>Failed: {r.error}
                        </span>
                      ) : r.verdict ? (
                        <span className="flex flex-wrap items-center gap-1.5">
                          <VerdictBadge verdict={r.verdict} />
                          {r.alertTypes.map((t) => (
                            <span key={t} className="text-[12px] text-alert">{alertTypeLabel(t)}</span>
                          ))}
                          {r.verdict !== "CLEAR" && <span className="block w-full text-[11px] text-dim">{r.reason}</span>}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}

function RunStatus({ run, onStop }: { run: Run; onStop: () => void }) {
  const [, force] = useState(0);
  const live = run.state === "running" || run.state === "resetting";
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [live]);

  const pct = run.total ? Math.round((run.sent / run.total) * 100) : 0;
  const elapsed = Math.max(0, (Date.now() - run.startedAt) / 1000);
  const result = run.state === "done" ? outcome(run) : null;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[14px] font-semibold">{run.scenario.name}</p>
        <p className="num text-[12px] text-dim">{run.symbol}</p>
      </div>
      <div>
        <div
          role="progressbar"
          aria-label="Events sent"
          aria-valuemin={0}
          aria-valuemax={run.total}
          aria-valuenow={run.sent}
          className="h-2 rounded-[2px] bg-panelhi"
        >
          <div className="h-full rounded-[2px] bg-text" style={{ width: `${pct}%` }} />
        </div>
        <p className="num mt-1 flex justify-between text-[11px] text-dim">
          <span>
            {run.sent}/{run.total} events
          </span>
          <span>
            {live && run.state === "running" ? `${elapsed.toFixed(1)}s of about ${(run.durationMs / 1000).toFixed(0)}s` : `${pct}%`}
          </span>
        </p>
      </div>
      <dl className="grid grid-cols-4 gap-px overflow-hidden rounded-[2px] border border-seam bg-seam text-center">
        {(["CLEAR", "REVIEW", "FLAG"] as const).map((v) => (
          <div key={v} className="bg-panel py-1.5">
            <dt className="text-[11px] text-dim">{v === "CLEAR" ? "Clear" : v === "REVIEW" ? "Review" : "Flag"}</dt>
            <dd className={`num text-[16px] ${v === "FLAG" && run.counts.FLAG > 0 ? "text-alert" : ""}`}>{run.counts[v]}</dd>
          </div>
        ))}
        <div className="bg-panel py-1.5">
          <dt className="text-[11px] text-dim">Failed</dt>
          <dd className="num text-[16px]">{run.errors}</dd>
        </div>
      </dl>
      <p className="text-[12px] leading-4 text-dim" role="status">
        {run.state === "resetting" && "Clearing simulated data first."}
        {run.state === "running" &&
          (run.lagMs > 1500
            ? `The server is answering slowly (${(run.lagMs / 1000).toFixed(1)}s behind). Events keep their scheduled timestamps, so the result is unaffected.`
            : "Streaming events to the engine.")}
        {run.state === "stopped" && `Stopped after ${run.sent} of ${run.total} events.`}
        {run.state === "failed" && null}
      </p>
      {run.fired.length > 0 && (
        <p className="text-[13px]">
          <span className="text-dim">Rules fired: </span>
          <span className="text-alert">{run.fired.map(alertTypeLabel).join(", ")}</span>
        </p>
      )}
      {result && (
        <p className={`rounded-[2px] border p-2 text-[13px] leading-[18px] ${result.ok ? "border-seam" : "border-ask/70"}`} role="status">
          <span aria-hidden="true">{result.ok ? "✓ " : "! "}</span>
          {result.text}
        </p>
      )}
      {run.state === "failed" && run.message && <ErrorState compact message={run.message} />}
      {live && (
        <Button variant="danger" onClick={onStop} className="w-full">
          <Stop size={14} aria-hidden="true" />
          Stop
        </Button>
      )}
      {!live && run.fired.length > 0 && (
        <Link href={`/alerts?symbol=${encodeURIComponent(run.symbol)}`} className={buttonClass("secondary", "sm")}>
          Review the alerts
        </Link>
      )}
    </div>
  );
}
