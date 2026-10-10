"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { DownloadSimple, FileArrowUp, Stop, UploadSimple } from "@phosphor-icons/react";
import type { AlertType, Verdict } from "@/lib/eventTypes";
import { ApiError, errorMessage, fetchJson, isAbortError } from "@/lib/clientApi";
import { CSV_COLUMNS, SAMPLE_CSV, validateCsv, type ParseResult } from "@/lib/csvImport";
import { alertTypeLabel, fmtInt } from "@/lib/format";
import { Button, ErrorState, Label, Panel, PageHeader, buttonClass, textareaClass } from "@/components/app/ui";

const BATCH = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ERRORS_SHOWN = 100;

type BatchResponse = {
  results: (
    | { index: number; ok: true; verdict: Verdict; alertTypes: AlertType[]; symbol: string }
    | { index: number; ok: false; error: string }
  )[];
  summary: { total: number; processed: number; failed: number } & Record<Verdict, number>;
};

type Progress = {
  state: "running" | "done" | "stopped" | "failed";
  sent: number;
  total: number;
  processed: number;
  failed: number;
  counts: Record<Verdict, number>;
  fired: Record<string, number>;
  symbols: string[];
  rowErrors: { line: number; error: string }[];
  message?: string;
};

export function Importer() {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const running = progress?.state === "running";

  const downloadSample = () => {
    const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "argus-sample-events.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onFile = async (file: File | undefined) => {
    setFileError(null);
    setParsed(null);
    setProgress(null);
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setFileError(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 5 MB.`);
      return;
    }
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
      setParsed(validateCsv(content));
    } catch {
      setFileError("The file could not be read. Save it as UTF-8 CSV and try again.");
    }
  };

  const validate = () => {
    setProgress(null);
    setParsed(validateCsv(text));
  };

  const runImport = async () => {
    if (!parsed || parsed.events.length === 0 || running) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const { events, lines } = parsed;
    const p: Progress = {
      state: "running",
      sent: 0,
      total: events.length,
      processed: 0,
      failed: 0,
      counts: { CLEAR: 0, REVIEW: 0, FLAG: 0 },
      fired: {},
      symbols: [],
      rowErrors: [],
    };
    setProgress({ ...p });
    const symbols = new Set<string>();
    try {
      for (let start = 0; start < events.length; start += BATCH) {
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const chunk = events.slice(start, start + BATCH);
        try {
          const r = await fetchJson<BatchResponse>("/api/events/batch", {
            method: "POST",
            body: JSON.stringify({ events: chunk }),
            signal: controller.signal,
          });
          for (const item of r.results) {
            if (item.ok) {
              p.processed++;
              p.counts[item.verdict]++;
              symbols.add(item.symbol);
              for (const t of item.alertTypes) p.fired[t] = (p.fired[t] ?? 0) + 1;
            } else {
              p.failed++;
              p.rowErrors.push({ line: lines[start + item.index], error: item.error });
            }
          }
        } catch (err) {
          if (isAbortError(err)) throw err;
          if (err instanceof ApiError && err.status === 400 && Array.isArray(err.details)) {
            // The server validated the batch and saved nothing.
            for (const d of err.details as { index: number; errors: string[] }[]) {
              p.rowErrors.push({ line: lines[start + d.index], error: d.errors.join("; ") });
            }
            p.failed += chunk.length;
          } else {
            p.failed += chunk.length;
            p.rowErrors.push({ line: lines[start], error: `Batch of ${chunk.length} rows failed: ${errorMessage(err)}` });
          }
        }
        p.sent = Math.min(events.length, start + chunk.length);
        p.symbols = Array.from(symbols);
        setProgress({ ...p, counts: { ...p.counts }, fired: { ...p.fired } });
      }
      setProgress({ ...p, state: "done", symbols: Array.from(symbols) });
    } catch (err) {
      if (isAbortError(err)) setProgress({ ...p, state: "stopped", symbols: Array.from(symbols) });
      else setProgress({ ...p, state: "failed", message: errorMessage(err) });
    } finally {
      controllerRef.current = null;
    }
  };

  const validCount = parsed?.events.length ?? 0;
  const errorCount = parsed?.errors.length ?? 0;

  return (
    <div>
      <PageHeader title="Import order events" description="Load a CSV of your own order flow. Every row is validated in the browser first, then sent through the surveillance engine in batches.">
        <Button size="sm" onClick={downloadSample}>
          <DownloadSimple size={14} aria-hidden="true" />
          Download sample CSV
        </Button>
      </PageHeader>

      <div className="stagger grid gap-4 lg:grid-cols-12">
        <Panel n={1} title="Columns" meta="first row must be a header" className="lg:col-span-5" bodyClassName="overflow-x-auto">
          <table className="w-full text-[12px]">
            <caption className="sr-only">CSV columns</caption>
            <thead>
              <tr className="border-b border-seam text-[11px] text-dim">
                <th scope="col" className="px-2 py-1 text-left font-medium">Column</th>
                <th scope="col" className="px-2 py-1 text-left font-medium">Required</th>
                <th scope="col" className="px-2 py-1 text-left font-medium">Format</th>
              </tr>
            </thead>
            <tbody>
              {CSV_COLUMNS.map((c) => (
                <tr key={c.name} className="border-b border-seam/50 align-top">
                  <td className="num px-2 py-1">{c.name}</td>
                  <td className="px-2 py-1">{c.required ? "Yes" : "No"}</td>
                  <td className="px-2 py-1 leading-4 text-dim">{c.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-2 py-2 text-[12px] leading-4 text-dim">
            Rows are sent in batches of 200 in file order, and each event is checked by the engine as it is saved. For
            accurate results keep rows in time order. Symbols starting with SIM can be cleared from the simulator.
          </p>
        </Panel>

        <Panel n={2} title="Your data" className="lg:col-span-7" bodyClassName="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className={`${buttonClass("secondary", "md")} cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-text`}>
              <FileArrowUp size={14} aria-hidden="true" />
              Choose a CSV file
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                disabled={running}
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
            <span className="text-[12px] text-dim">{fileName ? `Loaded ${fileName}` : "or paste rows below. Up to 5 MB."}</span>
          </div>
          {fileError && <ErrorState compact message={fileError} />}
          <div>
            <Label htmlFor="csv-text">CSV text</Label>
            <textarea
              id="csv-text"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setFileName(null);
                setParsed(null);
              }}
              disabled={running}
              rows={10}
              spellCheck={false}
              placeholder={"symbol,accountId,side,eventType,price,size,createdAt\nSIMCSV,MM-01,BUY,place,100.24,300,"}
              className={`${textareaClass} font-mono text-[12px] leading-4`}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={validate} disabled={!text.trim() || running}>
              Check rows
            </Button>
            {parsed && validCount > 0 && !running && (
              <Button variant="primary" onClick={runImport}>
                <UploadSimple size={14} aria-hidden="true" />
                {errorCount > 0
                  ? `Import ${fmtInt(validCount)} valid rows, skip ${fmtInt(errorCount)}`
                  : `Import ${fmtInt(validCount)} rows`}
              </Button>
            )}
            {running && (
              <Button variant="danger" onClick={() => controllerRef.current?.abort()}>
                <Stop size={14} aria-hidden="true" />
                Stop after this batch
              </Button>
            )}
          </div>
        </Panel>

        {parsed && (
          <Panel n={3} title="Validation" className="lg:col-span-5" bodyClassName="p-4">
            {parsed.headerError ? (
              <ErrorState compact message={parsed.headerError} />
            ) : (
              <>
                <p className="text-[13px]" role="status">
                  <span className="num">{fmtInt(validCount)}</span> valid row{validCount === 1 ? "" : "s"},{" "}
                  <span className="num">{fmtInt(errorCount)}</span> with errors.
                </p>
                {errorCount > 0 && (
                  <ul className="mt-2 max-h-72 overflow-auto border-t border-seam text-[12px]" aria-label="Row errors">
                    {parsed.errors.slice(0, ERRORS_SHOWN).map((e) => (
                      <li key={e.line} className="border-b border-seam/50 py-1">
                        <span className="num text-text">Line {e.line}:</span>{" "}
                        <span className="text-dim">{e.errors.join("; ")}</span>
                      </li>
                    ))}
                    {errorCount > ERRORS_SHOWN && (
                      <li className="py-1 text-dim">and {fmtInt(errorCount - ERRORS_SHOWN)} more.</li>
                    )}
                  </ul>
                )}
              </>
            )}
          </Panel>
        )}

        {progress && (
          <Panel n={4} title="Results" className={parsed ? "lg:col-span-7" : "lg:col-span-12"} bodyClassName="space-y-3 p-4">
            <div
              role="progressbar"
              aria-label="Rows sent"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.sent}
              className="h-2 rounded-[2px] bg-panelhi"
            >
              <div className="h-full rounded-[2px] bg-text" style={{ width: `${progress.total ? (progress.sent / progress.total) * 100 : 0}%` }} />
            </div>
            <p className="num text-[12px] text-dim" role="status">
              {fmtInt(progress.sent)}/{fmtInt(progress.total)} sent.{" "}
              {progress.state === "running" ? "Importing." : progress.state === "stopped" ? "Stopped." : progress.state === "done" ? "Done." : "Failed."}
            </p>
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[2px] border border-seam bg-seam text-center sm:grid-cols-5">
              {[
                ["Saved", progress.processed],
                ["Clear", progress.counts.CLEAR],
                ["Review", progress.counts.REVIEW],
                ["Flag", progress.counts.FLAG],
                ["Failed", progress.failed],
              ].map(([k, v]) => (
                <div key={k} className="bg-panel py-1.5">
                  <dt className="text-[11px] text-dim">{k}</dt>
                  <dd className={`num text-[16px] ${k === "Flag" && Number(v) > 0 ? "text-alert" : ""}`}>{fmtInt(Number(v))}</dd>
                </div>
              ))}
            </dl>
            {Object.keys(progress.fired).length > 0 && (
              <p className="text-[13px]">
                <span className="text-dim">Rules fired: </span>
                <span className="text-alert">
                  {Object.entries(progress.fired)
                    .map(([t, n]) => `${alertTypeLabel(t)} (${fmtInt(n)} events)`)
                    .join(", ")}
                </span>
              </p>
            )}
            {progress.message && <ErrorState compact message={progress.message} />}
            {progress.rowErrors.length > 0 && (
              <ul className="max-h-48 overflow-auto border-t border-seam text-[12px]" aria-label="Rows the server did not save">
                {progress.rowErrors.slice(0, ERRORS_SHOWN).map((e, i) => (
                  <li key={i} className="border-b border-seam/50 py-1">
                    <span className="num">Line {e.line}:</span> <span className="text-dim">{e.error}</span>
                  </li>
                ))}
              </ul>
            )}
            {progress.state !== "running" && progress.symbols.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {progress.symbols.slice(0, 6).map((s) => (
                  <Link key={s} href={`/dashboard?symbol=${encodeURIComponent(s)}`} className={buttonClass("secondary", "sm")}>
                    Open {s} on the dashboard
                  </Link>
                ))}
                <Link href="/alerts" className={buttonClass("ghost", "sm")}>
                  Review alerts
                </Link>
              </div>
            )}
          </Panel>
        )}
      </div>
    </div>
  );
}
