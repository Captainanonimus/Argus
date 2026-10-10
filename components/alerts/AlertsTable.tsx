"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, CaretUp, DownloadSimple, X } from "@phosphor-icons/react";
import { ALERT_STATUSES, ALERT_TYPES, VERDICTS, type AlertStatus } from "@/lib/eventTypes";
import {
  errorMessage,
  fetchJson,
  isAbortError,
  type AlertsResponse,
  type ApiAlertWithEvent,
} from "@/lib/clientApi";
import { ALERT_TYPE_LABEL, STATUS_LABEL, fmtDateTime, fmtMetric, fmtTimeMs } from "@/lib/format";
import {
  Button,
  EmptyState,
  ErrorState,
  Label,
  LoadingState,
  PageHeader,
  VerdictBadge,
  Card,
  buttonClass,
  inputClass,
  selectClass,
} from "@/components/app/ui";

type SortKey = "time" | "symbol" | "type" | "verdict" | "metric" | "status";
type Sort = { key: SortKey; dir: "asc" | "desc" };

const PAGE_SIZES = [25, 50, 100] as const;
const VERDICT_RANK: Record<string, number> = { CLEAR: 0, REVIEW: 1, FLAG: 2 };
const STATUS_RANK: Record<string, number> = { open: 0, investigating: 1, escalated: 2, dismissed: 3 };

const FILTER_KEYS = ["status", "verdict", "type", "symbol", "q"] as const;

function sortValue(a: ApiAlertWithEvent, key: SortKey): string | number {
  switch (key) {
    case "time":
      return new Date(a.createdAt).getTime();
    case "symbol":
      return a.orderEvent.symbol;
    case "type":
      return a.alertType;
    case "verdict":
      return VERDICT_RANK[a.verdict] ?? -1;
    case "metric":
      return a.metricValue;
    case "status":
      return STATUS_RANK[a.status] ?? -1;
  }
}

export function AlertsTable() {
  const router = useRouter();
  const pathname = usePathname() ?? "/alerts";
  const params = useSearchParams();

  const filters = useMemo(() => {
    const f: Record<(typeof FILTER_KEYS)[number], string> = { status: "", verdict: "", type: "", symbol: "", q: "" };
    for (const k of FILTER_KEYS) f[k] = params?.get(k) ?? "";
    return f;
  }, [params]);
  const limitParam = Number(params?.get("limit"));
  const limit = (PAGE_SIZES as readonly number[]).includes(limitParam) ? limitParam : 50;

  const filterQs = useMemo(() => {
    const qs = new URLSearchParams();
    for (const k of FILTER_KEYS) if (filters[k].trim()) qs.set(k, filters[k].trim());
    return qs.toString();
  }, [filters]);
  const hasFilters = filterQs.length > 0;

  const setParam = useCallback(
    (updates: Record<string, string>) => {
      const qs = new URLSearchParams(params?.toString() ?? "");
      for (const [k, v] of Object.entries(updates)) {
        if (v) qs.set(k, v);
        else qs.delete(k);
      }
      const s = qs.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // Text inputs apply after a short pause.
  const [symbolInput, setSymbolInput] = useState(filters.symbol);
  const [qInput, setQInput] = useState(filters.q);
  useEffect(() => setSymbolInput(filters.symbol), [filters.symbol]);
  useEffect(() => setQInput(filters.q), [filters.q]);
  useEffect(() => {
    const id = setTimeout(() => {
      const sym = symbolInput.trim().toUpperCase();
      if (sym !== filters.symbol || qInput.trim() !== filters.q) setParam({ symbol: sym, q: qInput.trim() });
    }, 350);
    return () => clearTimeout(id);
  }, [symbolInput, qInput, filters.symbol, filters.q, setParam]);

  // Cursor pagination: stack of cursors, reset whenever filters change.
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const page = cursors.length - 1;
  const pageKey = `${filterQs}|${limit}`;
  const lastKey = useRef(pageKey);
  useEffect(() => {
    if (lastKey.current === pageKey) return;
    lastKey.current = pageKey;
    setCursors([null]);
  }, [pageKey]);

  const [data, setData] = useState<AlertsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const cursor = cursors[cursors.length - 1];
    const qs = new URLSearchParams(filterQs);
    qs.set("limit", String(limit));
    if (cursor) qs.set("cursor", cursor);
    setLoading(true);
    setError(null);
    fetchJson<AlertsResponse>(`/api/alerts?${qs}`, { signal: controller.signal })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        if (isAbortError(err)) return;
        setError(errorMessage(err));
        setLoading(false);
      });
    return () => controller.abort();
  }, [filterQs, limit, cursors, tick]);

  const [sort, setSort] = useState<Sort>({ key: "time", dir: "desc" });
  const rows = useMemo(() => {
    const list = [...(data?.alerts ?? [])];
    list.sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
      return sort.dir === "asc" ? c : -c;
    });
    return list;
  }, [data, sort]);

  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const changeStatus = async (alert: ApiAlertWithEvent, status: AlertStatus) => {
    const prev = alert.status;
    setRowError(null);
    setSaving(alert.id);
    setData((d) => d && { ...d, alerts: d.alerts.map((a) => (a.id === alert.id ? { ...a, status } : a)) });
    try {
      await fetchJson(`/api/alerts/${alert.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
    } catch (err) {
      setData((d) => d && { ...d, alerts: d.alerts.map((a) => (a.id === alert.id ? { ...a, status: prev } : a)) });
      setRowError({ id: alert.id, message: `Status not saved: ${errorMessage(err)}` });
    } finally {
      setSaving(null);
    }
  };

  const exportHref = `/api/alerts/export${filterQs ? `?${filterQs}` : ""}`;

  return (
    <div>
      <PageHeader title="Alerts" description="Every alert the surveillance engine raised, newest first. Filter, triage the status in place, or open a case.">
        <a href={exportHref} download className={buttonClass("secondary", "sm")}>
          <DownloadSimple size={14} aria-hidden="true" />
          Export CSV
        </a>
      </PageHeader>

      <form
        role="search"
        aria-label="Filter alerts"
        onSubmit={(e) => e.preventDefault()}
        className="mb-4 grid grid-cols-2 gap-x-3 gap-y-3 rounded-[2px] border border-seam bg-panel p-4 sm:grid-cols-3 lg:grid-cols-6"
      >
        <SelectFilter id="f-status" label="Status" value={filters.status} onChange={(v) => setParam({ status: v })}
          options={ALERT_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))} />
        <SelectFilter id="f-verdict" label="Verdict" value={filters.verdict} onChange={(v) => setParam({ verdict: v })}
          options={VERDICTS.map((v) => ({ value: v, label: v }))} />
        <SelectFilter id="f-type" label="Rule" value={filters.type} onChange={(v) => setParam({ type: v })}
          options={ALERT_TYPES.map((t) => ({ value: t, label: ALERT_TYPE_LABEL[t] }))} />
        <div>
          <Label htmlFor="f-symbol">Symbol</Label>
          <input id="f-symbol" value={symbolInput} onChange={(e) => setSymbolInput(e.target.value)}
            placeholder="Any" maxLength={16} autoComplete="off" spellCheck={false}
            className={`${inputClass} font-mono uppercase placeholder:normal-case`} />
        </div>
        <div className="col-span-2 sm:col-span-1 lg:col-span-1">
          <Label htmlFor="f-q">Search</Label>
          <input id="f-q" type="search" value={qInput} onChange={(e) => setQInput(e.target.value)}
            placeholder="Reason, note, account" maxLength={200} className={inputClass} />
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Label htmlFor="f-limit">Rows</Label>
            <select id="f-limit" value={limit} onChange={(e) => setParam({ limit: e.target.value === "50" ? "" : e.target.value })} className={selectClass}>
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          {hasFilters && (
            <Button size="md" variant="ghost" onClick={() => setParam({ status: "", verdict: "", type: "", symbol: "", q: "" })}>
              <X size={14} aria-hidden="true" />
              Clear
            </Button>
          )}
        </div>
      </form>

      {error && <ErrorState message={`Could not load alerts. ${error}`} onRetry={() => setTick((t) => t + 1)} />}
      {rowError && <ErrorState compact message={rowError.message} />}

      {!error && loading && !data && <LoadingState label="Loading alerts" rows={10} />}

      {!error && data && rows.length === 0 && (
        <Card>
          {hasFilters || page > 0 ? (
            <EmptyState
              title="No alerts match these filters."
              body="Widen the filters, or run a scenario to generate new alerts."
              secondary={
                <Button size="sm" variant="ghost" onClick={() => setParam({ status: "", verdict: "", type: "", symbol: "", q: "" })}>
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No alerts yet."
              body="Alerts are raised when a surveillance rule fires. Run the spoofing or quote stuffing scenario to see one."
            />
          )}
        </Card>
      )}

      {!error && data && rows.length > 0 && (
        <div className={`overflow-x-auto rounded-[2px] border border-seam bg-panel transition-opacity duration-150 ${loading ? "opacity-60" : ""}`} aria-busy={loading}>
          <table className="w-full min-w-[760px] text-[12px]">
            <caption className="sr-only">
              Alerts, page {page + 1}. Column headers sort the rows on this page.
            </caption>
            <thead>
              <tr className="border-b border-seam text-[11px] text-dim">
                <SortHeader label="Time" k="time" sort={sort} setSort={setSort} />
                <SortHeader label="Symbol" k="symbol" sort={sort} setSort={setSort} />
                <SortHeader label="Rule" k="type" sort={sort} setSort={setSort} />
                <SortHeader label="Verdict" k="verdict" sort={sort} setSort={setSort} />
                <SortHeader label="Metric" k="metric" sort={sort} setSort={setSort} align="right" />
                <th scope="col" className="px-2 py-1.5 text-left font-medium">Reason</th>
                <SortHeader label="Status" k="status" sort={sort} setSort={setSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className={`border-b border-seam/60 hover:bg-panelhi ${a.verdict === "FLAG" ? "outline outline-1 -outline-offset-1 outline-alert/70" : ""}`}>
                  <td className="num whitespace-nowrap px-2 py-1.5 text-[11px] text-dim" title={fmtDateTime(a.createdAt)}>
                    <span className="block">{fmtDateTime(a.createdAt).slice(0, 10)}</span>
                    {fmtTimeMs(a.createdAt)}
                  </td>
                  <td className="num px-2 py-1.5">
                    <Link href={`/dashboard?symbol=${encodeURIComponent(a.orderEvent.symbol)}`} className="hover:underline">
                      {a.orderEvent.symbol}
                    </Link>
                  </td>
                  <td className="px-2 py-1.5">
                    <Link href={`/alerts/${a.id}`} className="text-[13px] font-semibold text-text underline-offset-2 hover:underline">
                      {ALERT_TYPE_LABEL[a.alertType] ?? a.alertType}
                      <span className="sr-only">, open case</span>
                    </Link>
                  </td>
                  <td className="px-2 py-1.5"><VerdictBadge verdict={a.verdict} /></td>
                  <td className="num px-2 py-1.5 text-right">{fmtMetric(a.alertType, a.metricValue)}</td>
                  <td className="max-w-[26rem] px-2 py-1.5 text-dim">
                    <span className="line-clamp-2" title={a.reason}>{a.reason}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <select
                      aria-label={`Status for ${ALERT_TYPE_LABEL[a.alertType] ?? a.alertType} alert on ${a.orderEvent.symbol} at ${fmtTimeMs(a.createdAt)}`}
                      value={a.status}
                      disabled={saving === a.id}
                      onChange={(e) => changeStatus(a, e.target.value as AlertStatus)}
                      className={`${selectClass} h-8 w-auto`}
                    >
                      {ALERT_STATUSES.map((s) => (
                        <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                      ))}
                    </select>
                    {rowError?.id === a.id && <span className="sr-only">{rowError.message}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!error && data && (rows.length > 0 || page > 0) && (
        <nav aria-label="Pagination" className="mt-3 flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={page === 0 || loading} onClick={() => setCursors((c) => c.slice(0, -1))}>
            Previous
          </Button>
          <span className="num text-[12px] text-dim" aria-live="polite">Page {page + 1}</span>
          <Button
            size="sm"
            disabled={!data.nextCursor || loading}
            onClick={() => data.nextCursor && setCursors((c) => [...c, data.nextCursor])}
          >
            Next
          </Button>
          <span className="ml-auto text-[12px] text-dim">
            {rows.length} on this page{data.nextCursor ? ", more available" : ""}
          </span>
        </nav>
      )}
    </div>
  );
}

function SelectFilter({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        <option value="">Any</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function SortHeader({
  label,
  k,
  sort,
  setSort,
  align = "left",
}: {
  label: string;
  k: SortKey;
  sort: Sort;
  setSort: (s: Sort) => void;
  align?: "left" | "right";
}) {
  const active = sort.key === k;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={`px-2 py-1 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => setSort({ key: k, dir: active && sort.dir === "desc" ? "asc" : "desc" })}
        className={`inline-flex items-center gap-1 rounded-[2px] px-1 py-0.5 hover:bg-panelhi hover:text-text ${active ? "text-text" : ""}`}
      >
        {label}
        <span aria-hidden="true" className="inline-flex w-3">
          {active ? sort.dir === "asc" ? <CaretUp size={10} /> : <CaretDown size={10} /> : null}
        </span>
      </button>
    </th>
  );
}
