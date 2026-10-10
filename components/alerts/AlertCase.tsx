"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChatCircleText, Printer } from "@phosphor-icons/react";
import type { AlertStatus } from "@/lib/eventTypes";
import { errorMessage, fetchJson, type AlertCaseResponse, type ApiAlert } from "@/lib/clientApi";
import { useJson } from "@/components/app/hooks";
import {
  alertTypeLabel,
  fmtDateTime,
  fmtInt,
  fmtMetric,
  fmtPrice,
  fmtRelative,
  fmtTimeMs,
  statusLabel,
} from "@/lib/format";
import { THRESHOLDS, explainMetric, ruleFor } from "@/lib/rules";
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Panel,
  SideTag,
  StatusTag,
  PageHeader,
  VerdictBadge,
  buttonClass,
  textareaClass,
} from "@/components/app/ui";

const NOTE_MAX = 2000;

const TRANSITIONS: Record<AlertStatus, { to: AlertStatus; label: string; variant: "primary" | "secondary" | "danger" }[]> = {
  open: [{ to: "investigating", label: "Start investigation", variant: "primary" }],
  investigating: [
    { to: "escalated", label: "Escalate", variant: "primary" },
    { to: "dismissed", label: "Dismiss", variant: "secondary" },
  ],
  escalated: [{ to: "investigating", label: "Reopen investigation", variant: "secondary" }],
  dismissed: [{ to: "investigating", label: "Reopen investigation", variant: "secondary" }],
};

export function AlertCase({ id }: { id: string }) {
  const { data, error, errorStatus, loading, reload, setData } = useJson<AlertCaseResponse>(
    `/api/alerts/${encodeURIComponent(id)}`,
  );
  const notFound = errorStatus === 404 || errorStatus === 400;

  if (loading && !data) return <LoadingState label="Loading case" rows={12} />;
  if (notFound) {
    return (
      <div>
        <PageHeader eyebrow="Case" title="Case not found" />
        <Panel title="Case not found">
          <EmptyState
            title="This alert does not exist."
            body="It may have been removed by a demo reset. Open the alert list to find another case."
            actionHref="/alerts"
            actionLabel="Back to alerts"
          />
        </Panel>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div>
        <PageHeader eyebrow="Case" title="Case unavailable" />
        <ErrorState message={`Could not load this case. ${error ?? ""}`} onRetry={reload} />
      </div>
    );
  }

  const update = (alert: ApiAlert) => setData((d) => (d ? { ...d, alert: { ...d.alert, ...alert } } : d));
  return <CaseView data={data} onUpdate={update} />;
}

function CaseView({ data, onUpdate }: { data: AlertCaseResponse; onUpdate: (a: ApiAlert) => void }) {
  const { alert, event, timeline } = data;
  const rule = ruleFor(alert.alertType);
  const title = `${alertTypeLabel(alert.alertType)} on ${event.symbol}`;

  return (
    <article data-print-surface aria-labelledby="case-title">
      <header className="pb-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-print-hide>
          <Link href="/alerts" className={buttonClass("ghost", "sm")}>
            <ArrowLeft size={14} aria-hidden="true" />
            Alerts
          </Link>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" onClick={() => window.print()}>
              <Printer size={14} aria-hidden="true" />
              Print report
            </Button>
            <Link href={`/assistant?alert=${encodeURIComponent(alert.id)}`} className={buttonClass("primary", "sm")}>
              <ChatCircleText size={14} aria-hidden="true" />
              Ask the assistant
            </Link>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 id="case-title" className="font-display text-[clamp(1.75rem,1.4rem+1.4vw,2.5rem)] font-medium leading-[1.12] tracking-[-0.02em] [text-wrap:balance]">
            {title}
          </h1>
          <VerdictBadge verdict={alert.verdict} />
          <StatusTag status={alert.status} />
        </div>
        <dl className="num mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-dim">
          <div className="flex gap-1">
            <dt>Raised</dt>
            <dd className="text-text">{fmtDateTime(alert.createdAt)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Updated</dt>
            <dd className="text-text">{fmtRelative(alert.updatedAt)}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Case id</dt>
            <dd className="text-text">{alert.id}</dd>
          </div>
        </dl>
      </header>

      <div className="stagger grid gap-4 lg:grid-cols-12">
        <Panel n={1} title="Verdict and reason" meta={rule ? `${rule.code} ${rule.name}` : undefined} className="lg:col-span-7" bodyClassName="space-y-3 p-4">
          <div>
            <p className="text-xs font-medium text-dim">Engine reason</p>
            <p className="mt-0.5 text-[13px] leading-[18px]">{alert.reason}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-dim">What the numbers mean</p>
            <p className="mt-0.5 max-w-[70ch] text-[13px] leading-[18px]">
              {explainMetric(alert.alertType, alert.metricValue, event.symbol)}
            </p>
          </div>
          <MetricMeter type={alert.alertType} value={alert.metricValue} />
          <p className="text-[12px] leading-4 text-dim">
            This is a statistical signal for human review, not a finding of misconduct.{" "}
            <Link href="/rules" className="underline underline-offset-2 hover:text-text" data-print-hide>
              How the rules work
            </Link>
          </p>
        </Panel>

        <Panel n={2} title="Triggering event" className="lg:col-span-5" bodyClassName="p-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-[12px] text-dim">Time</dt>
            <dd className="num">{fmtDateTime(event.createdAt)}.{fmtTimeMs(event.createdAt).slice(-3)}</dd>
            <dt className="text-[12px] text-dim">Symbol</dt>
            <dd className="num">
              <Link href={`/dashboard?symbol=${encodeURIComponent(event.symbol)}`} className="underline-offset-2 hover:underline">
                {event.symbol}
              </Link>
            </dd>
            <dt className="text-[12px] text-dim">Event</dt>
            <dd>{event.eventType}</dd>
            <dt className="text-[12px] text-dim">Side</dt>
            <dd><SideTag side={event.side} /></dd>
            <dt className="text-[12px] text-dim">Price</dt>
            <dd className="num">{fmtPrice(event.price)}</dd>
            <dt className="text-[12px] text-dim">Size</dt>
            <dd className="num">{fmtInt(event.size)}</dd>
            <dt className="text-[12px] text-dim">Account</dt>
            <dd className="num">{event.accountId}</dd>
            <dt className="text-[12px] text-dim">Event id</dt>
            <dd className="num break-all text-[12px] text-dim">{event.id}</dd>
          </dl>
        </Panel>

        <Workflow alert={alert} onUpdate={onUpdate} />
        <Notes alert={alert} onUpdate={onUpdate} />

        <Panel
          n={5}
          tone="terminal"
          title="Event timeline"
          meta={`${event.symbol}, ${data.window.beforeMs / 1000}s before to ${data.window.afterMs / 1000}s after`}
          className="lg:col-span-12"
          bodyClassName="overflow-x-auto"
        >
          <Timeline data={data} />
        </Panel>
      </div>

      <footer className="hidden px-4 py-3 text-[11px] print:block">
        Argus case report for alert {alert.id}, printed {fmtDateTime(new Date())}. Alerts are statistical signals for human review.
      </footer>
      {timeline.length === 0 && <span className="sr-only">The timeline has no events.</span>}
    </article>
  );
}

function MetricMeter({ type, value }: { type: string; value: number }) {
  const t = THRESHOLDS;
  let max = 1;
  let lines: { at: number; label: string }[] = [];
  let label = "";
  if (type === "quote_stuffing") {
    max = Math.max(t.otrFlag * 2, value * 1.15);
    lines = [{ at: t.otrFlag, label: `Flag ${t.otrFlag}:1` }];
    label = "Order-to-trade ratio";
  } else if (type === "spoofing") {
    max = Math.max(t.largeOrder * 2, value * 1.15);
    lines = [{ at: t.largeOrder, label: `Large order ${fmtInt(t.largeOrder)}` }];
    label = "Canceled size";
  } else if (type === "book_imbalance") {
    max = Math.max(t.zFlag * 1.6, value * 1.15);
    lines = [
      { at: t.zReview, label: `Review ${t.zReview}` },
      { at: t.zFlag, label: `Flag ${t.zFlag}` },
    ];
    label = "Imbalance z-score";
  } else return null;

  const pct = (v: number) => `${Math.min(100, (v / max) * 100)}%`;
  return (
    <figure className="pt-1">
      <figcaption className="flex justify-between text-[11px] text-dim">
        <span>{label}</span>
        <span className="num text-text">{fmtMetric(type, value)}</span>
      </figcaption>
      <div className="relative mt-5 h-2 rounded-[2px] bg-panelhi" role="img" aria-label={`${label} ${fmtMetric(type, value)}; ${lines.map((l) => l.label).join(", ")}`}>
        <div className="absolute inset-y-0 left-0 rounded-[2px]" style={{ width: pct(value), background: "var(--m-gradient)" }} />
        {lines.map((l) => (
          <div key={l.label} className="absolute -top-4 bottom-0" style={{ left: pct(l.at) }}>
            <span className="num absolute -top-0.5 -translate-x-1/2 whitespace-nowrap text-[10px] text-dim">{l.label}</span>
            <span className="absolute bottom-0 top-3 w-px bg-text" />
          </div>
        ))}
      </div>
    </figure>
  );
}

function Workflow({ alert, onUpdate }: { alert: ApiAlert; onUpdate: (a: ApiAlert) => void }) {
  const [busy, setBusy] = useState<AlertStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = alert.status;
  const steps: AlertStatus[] = ["open", "investigating", status === "dismissed" ? "dismissed" : "escalated"];
  const reached = (s: AlertStatus) =>
    s === status || (s === "open") || (s === "investigating" && (status === "escalated" || status === "dismissed"));

  const move = async (to: AlertStatus) => {
    setBusy(to);
    setError(null);
    try {
      const r = await fetchJson<{ alert: ApiAlert }>(`/api/alerts/${alert.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: to }),
      });
      onUpdate(r.alert);
    } catch (err) {
      setError(`Status not changed: ${errorMessage(err)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel n={3} title="Status" className="lg:col-span-5" bodyClassName="p-4">
      <ol className="flex flex-wrap items-center gap-1 text-[12px]" aria-label="Case workflow">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span
              aria-current={s === status ? "step" : undefined}
              className={`rounded-[2px] border px-2 py-0.5 ${s === status ? "border-text bg-panelhi text-text" : reached(s) ? "border-seam text-text" : "border-seam text-dim"}`}
            >
              {statusLabel(s)}
              {s === status && <span className="sr-only"> (current)</span>}
            </span>
            {i < steps.length - 1 && <span aria-hidden="true" className="text-dim">›</span>}
          </li>
        ))}
        {status !== "dismissed" && status !== "escalated" && (
          <li className="text-[11px] text-dim">or Dismissed</li>
        )}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2" data-print-hide>
        {TRANSITIONS[status]?.map((t) => (
          <Button key={t.to} variant={t.variant} size="sm" disabled={busy !== null} onClick={() => move(t.to)}>
            {busy === t.to ? "Saving" : t.label}
          </Button>
        ))}
      </div>
      {error && <ErrorState compact message={error} />}
    </Panel>
  );
}

function Notes({ alert, onUpdate }: { alert: ApiAlert; onUpdate: (a: ApiAlert) => void }) {
  const [draft, setDraft] = useState(alert.note);
  const [state, setState] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const dirty = draft !== alert.note;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = async () => {
    setState("saving");
    setError(null);
    try {
      const r = await fetchJson<{ alert: ApiAlert }>(`/api/alerts/${alert.id}`, {
        method: "PATCH",
        body: JSON.stringify({ note: draft }),
      });
      onUpdate(r.alert);
      setState("saved");
    } catch (err) {
      setError(`Note not saved: ${errorMessage(err)}`);
      setState("idle");
    }
  };

  return (
    <Panel n={4} title="Analyst notes" className="lg:col-span-7" bodyClassName="p-4">
      <label htmlFor="case-note" className="sr-only">Analyst notes</label>
      <textarea
        id="case-note"
        value={draft}
        maxLength={NOTE_MAX}
        onChange={(e) => {
          setDraft(e.target.value);
          setState("idle");
        }}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && dirty) save();
        }}
        rows={5}
        placeholder="What you checked, who you spoke to, and why you escalated or dismissed."
        className={`${textareaClass} print:border-0 print:p-0`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-3" data-print-hide>
        <Button variant="primary" size="sm" onClick={save} disabled={!dirty || state === "saving"}>
          {state === "saving" ? "Saving" : "Save note"}
        </Button>
        <span className="text-[12px] text-dim" role="status">
          {state === "saved" && !dirty ? "Saved." : dirty ? "Unsaved changes. Ctrl+Enter saves." : ""}
        </span>
        <span className="num ml-auto text-[11px] text-dim">
          {draft.length}/{NOTE_MAX}
        </span>
      </div>
      {error && <ErrorState compact message={error} />}
    </Panel>
  );
}

function Timeline({ data }: { data: AlertCaseResponse }) {
  const { event, timeline, alert } = data;
  const t0 = new Date(event.createdAt).getTime();
  const counts = useMemo(() => {
    const c: Record<string, number> = { place: 0, cancel: 0, fill: 0 };
    for (const e of timeline) c[e.eventType] = (c[e.eventType] ?? 0) + 1;
    return c;
  }, [timeline]);
  const sameAccount = timeline.filter((e) => e.accountId === event.accountId).length;

  if (timeline.length === 0) {
    return <EmptyState title="No events in this window." actionHref={null} />;
  }
  return (
    <div>
      <p className="border-b border-seam px-3 py-1.5 text-[12px] text-dim">
        <span className="num text-text">{timeline.length}</span> events: <span className="num text-text">{counts.place}</span> placed,{" "}
        <span className="num text-text">{counts.cancel}</span> canceled, <span className="num text-text">{counts.fill}</span> filled.{" "}
        <span className="num text-text">{sameAccount}</span> from account <span className="num text-text">{event.accountId}</span>.
      </p>
      <table className="w-full min-w-[720px] text-[12px]">
        <caption className="sr-only">Order events around the trigger, oldest first</caption>
        <thead>
          <tr className="border-b border-seam text-[11px] text-dim">
            <th scope="col" className="px-2 py-1 text-right font-medium">Offset</th>
            <th scope="col" className="px-2 py-1 text-left font-medium">Time</th>
            <th scope="col" className="px-2 py-1 text-left font-medium">Event</th>
            <th scope="col" className="px-2 py-1 text-left font-medium">Side</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">Price</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">Size</th>
            <th scope="col" className="px-2 py-1 text-left font-medium">Account</th>
            <th scope="col" className="px-2 py-1 text-left font-medium">Alerts</th>
          </tr>
        </thead>
        <tbody>
          {timeline.map((e) => {
            const trigger = e.id === event.id;
            const off = new Date(e.createdAt).getTime() - t0;
            return (
              <tr
                key={e.id}
                className={`border-b border-seam/50 ${trigger ? "bg-panelhi outline outline-1 -outline-offset-1 outline-alert" : "hover:bg-panelhi"}`}
              >
                <td className="num px-2 py-0.5 text-right text-dim">{off >= 0 ? "+" : "-"}{(Math.abs(off) / 1000).toFixed(3)}s</td>
                <td className="num whitespace-nowrap px-2 py-0.5 text-[11px] text-dim">{fmtTimeMs(e.createdAt)}</td>
                <td className="px-2 py-0.5">
                  {e.eventType}
                  {trigger && <span className="ml-2 rounded-[2px] bg-alert px-1 text-[11px] font-semibold text-ink">Trigger</span>}
                </td>
                <td className="px-2 py-0.5"><SideTag side={e.side} /></td>
                <td className="num px-2 py-0.5 text-right">{fmtPrice(e.price)}</td>
                <td className="num px-2 py-0.5 text-right">{fmtInt(e.size)}</td>
                <td className={`num px-2 py-0.5 ${e.accountId === event.accountId ? "text-text" : "text-dim"}`}>{e.accountId}</td>
                <td className="px-2 py-0.5">
                  {e.alerts.map((a) =>
                    a.id === alert.id ? (
                      <span key={a.id} className="text-[12px] text-alert">This alert</span>
                    ) : (
                      <Link key={a.id} href={`/alerts/${a.id}`} className="mr-2 text-[12px] text-alert underline-offset-2 hover:underline">
                        {alertTypeLabel(a.alertType)} {a.verdict}
                      </Link>
                    ),
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
