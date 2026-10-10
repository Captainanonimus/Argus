"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsOutSimple, Pause, Play, Table, ChartLine } from "@phosphor-icons/react";
import {
  errorMessage,
  fetchJson,
  isAbortError,
  type AlertsResponse,
  type ChartResponse,
  type FeedResponse,
  type StatsResponse,
  type SymbolsResponse,
} from "@/lib/clientApi";
import { alertTypeLabel, fmtInt, fmtMetric, fmtPrice, fmtRelative, fmtSigned, fmtTimeMs } from "@/lib/format";
import { useVisiblePoll } from "@/components/app/hooks";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
  Kpi,
  LoadingState,
  PageHeader,
  Panel,
  SideTag,
  StatusTag,
  VerdictBadge,
  buttonClass,
  selectClass,
} from "@/components/app/ui";
import { normalizeTicker } from "@/components/app/ticker";
import { PriceChart } from "./PriceChart";

const POLL_MS = 1500;
const ANNOUNCE_GAP_MS = 5000;

type Live = {
  chart: ChartResponse | null;
  stats: StatsResponse | null;
  feed: FeedResponse | null;
  alerts: AlertsResponse | null;
};

export function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const urlSymbol = normalizeTicker(params?.get("symbol") ?? "");

  const [symbols, setSymbols] = useState<SymbolsResponse["symbols"] | null>(null);
  const [symbolsError, setSymbolsError] = useState<string | null>(null);
  const [live, setLive] = useState<Live>({ chart: null, stats: null, feed: null, alerts: null });
  const [liveError, setLiveError] = useState<string | null>(null);
  const [lastOk, setLastOk] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);

  const loadSymbols = useCallback(async (signal?: AbortSignal) => {
    try {
      const d = await fetchJson<SymbolsResponse>("/api/symbols", { signal });
      setSymbols(d.symbols);
      setSymbolsError(null);
    } catch (err) {
      if (!isAbortError(err)) setSymbolsError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    const c = new AbortController();
    loadSymbols(c.signal);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") loadSymbols();
    }, 10_000);
    return () => {
      c.abort();
      clearInterval(id);
    };
  }, [loadSymbols]);

  // Default to the symbol with the most recent event.
  const symbol = useMemo(() => {
    if (urlSymbol) return urlSymbol;
    if (!symbols || symbols.length === 0) return null;
    return [...symbols].sort(
      (a, b) => new Date(b.lastEventAt ?? 0).getTime() - new Date(a.lastEventAt ?? 0).getTime(),
    )[0].symbol;
  }, [urlSymbol, symbols]);

  const chooseSymbol = (s: string) => {
    router.replace(`/dashboard?symbol=${encodeURIComponent(s)}`, { scroll: false });
  };

  // Reset live panels when the symbol changes.
  useEffect(() => {
    setLive({ chart: null, stats: null, feed: null, alerts: null });
    setLiveError(null);
    setLastOk(null);
  }, [symbol]);

  const poll = useCallback(
    async (signal: AbortSignal) => {
      if (!symbol) return;
      const q = encodeURIComponent(symbol);
      try {
        const [chart, stats, feed, alerts] = await Promise.all([
          fetchJson<ChartResponse>(`/api/chart?symbol=${q}&seconds=300`, { signal }),
          fetchJson<StatsResponse>(`/api/stats?symbol=${q}`, { signal }),
          fetchJson<FeedResponse>(`/api/feed?symbol=${q}&limit=60`, { signal }),
          fetchJson<AlertsResponse>(`/api/alerts?symbol=${q}&limit=25`, { signal }),
        ]);
        if (signal.aborted) return;
        setLive({ chart, stats, feed, alerts });
        setLiveError(null);
        setLastOk(Date.now());
      } catch (err) {
        if (!isAbortError(err)) setLiveError(errorMessage(err));
      }
    },
    [symbol],
  );
  useVisiblePoll(poll, POLL_MS, !!symbol && !paused);

  const openAlert = useCallback((id: string) => router.push(`/alerts/${id}`), [router]);
  const announcement = useAlertAnnouncer(live.alerts, symbol);

  if (symbolsError && !symbols) {
    return (
      <div>
        <PageHeader title="Dashboard" />
        <ErrorState message={`Could not load symbols. ${symbolsError}`} onRetry={() => loadSymbols()} />
      </div>
    );
  }
  if (!symbols) return <LoadingState label="Loading symbols" rows={10} />;
  if (!symbol) {
    return (
      <div>
        <PageHeader title="Dashboard" description="The live terminal for one symbol: price, depth, trades and the alerts raised on it." />
        <Panel title="No market data yet" n={0}>
          <EmptyState
            title="There is no order flow to watch."
            body="Run a scenario in the simulator to stream events through the surveillance engine, or import a CSV of your own order events."
            secondary={
              <Link href="/import" className={buttonClass("ghost", "sm")}>
                Import a CSV
              </Link>
            }
          />
        </Panel>
      </div>
    );
  }

  const known = symbols.some((s) => s.symbol === symbol);
  const loadingLive = !live.chart && !liveError;

  return (
    <div className="flex flex-col gap-4">
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
      <Toolbar
        symbol={symbol}
        symbols={symbols}
        onChoose={chooseSymbol}
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        lastOk={lastOk}
        hasError={!!liveError}
      />
      {liveError && (
        <ErrorState compact message={`Live update failed: ${liveError} Retrying every 1.5s.`} onRetry={() => setPaused(false)} />
      )}
      {!known && !loadingLive && (
        <Card>
          <EmptyState
            title={`${symbol} has no events yet.`}
            body="Pick another symbol above, or send order flow for this one from the simulator."
            actionHref={`/simulator?symbol=${encodeURIComponent(symbol)}`}
          />
        </Card>
      )}

      <KpiStrip live={live} />

      {/* Market data stays on dark terminal panels, inset in the light page. */}
      <div className="stagger grid gap-4 lg:grid-cols-12">
        <Panel
          n={1}
          tone="terminal"
          title="Price"
          meta={`${symbol}, last 5 min`}
          className="h-[360px] sm:h-[440px] lg:col-span-8"
          actions={
            <>
              <IconButton label={paused ? "Resume live updates" : "Pause live updates"} onClick={() => setPaused((p) => !p)}>
                {paused ? <Play size={14} /> : <Pause size={14} />}
              </IconButton>
              <IconButton label="Fit all bars" onClick={() => setFitSignal((n) => n + 1)}>
                <ArrowsOutSimple size={14} />
              </IconButton>
              <IconButton
                label={showTable ? "Show chart" : "Show data table"}
                pressed={showTable}
                onClick={() => setShowTable((v) => !v)}
              >
                {showTable ? <ChartLine size={14} /> : <Table size={14} />}
              </IconButton>
            </>
          }
        >
          {loadingLive ? (
            <LoadingState label="Loading chart" rows={8} />
          ) : (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1">
                <PriceChart data={live.chart} onAlertClick={openAlert} showTable={showTable} fitSignal={fitSignal} />
              </div>
              <p className="shrink-0 border-t border-seam px-2 py-0.5 text-right text-[10px] text-dim">
                Charting by{" "}
                <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-text">
                  TradingView Lightweight Charts
                </a>
              </p>
            </div>
          )}
        </Panel>

        <Panel n={2} tone="terminal" title="Depth" meta="from resting orders, 5 min" className="lg:col-span-4 lg:h-[440px]" bodyClassName="overflow-auto">
          {loadingLive ? <LoadingState label="Loading depth" /> : <DepthLadder stats={live.stats} />}
        </Panel>

        <Panel n={3} tone="terminal" title="Time and sales" className="h-[360px] lg:col-span-5" bodyClassName="overflow-hidden">
          {loadingLive ? <LoadingState label="Loading trades" /> : <TimeAndSales feed={live.feed} />}
        </Panel>

        <Panel
          n={4}
          tone="terminal"
          title="Alert blotter"
          meta={live.stats ? `${fmtInt(live.stats.openAlerts)} open` : undefined}
          className="h-[360px] lg:col-span-7"
          bodyClassName="overflow-auto"
          actions={
            <Link href={`/alerts?symbol=${encodeURIComponent(symbol)}`} className="rounded-[2px] px-1.5 text-[12px] text-dim underline-offset-2 hover:bg-panelhi hover:text-text hover:underline">
              All alerts
            </Link>
          }
        >
          {loadingLive ? <LoadingState label="Loading alerts" /> : <AlertBlotter alerts={live.alerts} />}
        </Panel>
      </div>
    </div>
  );
}

function Toolbar({
  symbol,
  symbols,
  onChoose,
  paused,
  onTogglePause,
  lastOk,
  hasError,
}: {
  symbol: string;
  symbols: SymbolsResponse["symbols"];
  onChoose: (s: string) => void;
  paused: boolean;
  onTogglePause: () => void;
  lastOk: number | null;
  hasError: boolean;
}) {
  const options = symbols.some((s) => s.symbol === symbol) ? symbols : [{ symbol, lastPrice: null, lastEventAt: null, eventCount: 0 }, ...symbols];
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <PageHeader
      eyebrow="Dashboard"
      title={
        <>
          Watching <span className="font-mono text-[0.8em] tracking-normal">{symbol}</span>
        </>
      }
    >
      <label htmlFor="symbol-picker" className="text-xs font-medium text-dim">
        Symbol
      </label>
      <select
        id="symbol-picker"
        value={symbol}
        onChange={(e) => onChoose(e.target.value)}
        className={`${selectClass} num w-auto min-w-[9rem] font-mono`}
      >
        {options.map((s) => (
          <option key={s.symbol} value={s.symbol}>
            {s.symbol}
            {s.lastPrice !== null ? `  ${fmtPrice(s.lastPrice)}` : ""}
          </option>
        ))}
      </select>
      <Button size="sm" variant="ghost" onClick={onTogglePause} aria-pressed={paused}>
        {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        {paused ? "Resume" : "Pause"}
      </Button>
      <span className="min-w-[11rem] text-xs text-dim" role="status">
        {paused ? (
          <>
            <span aria-hidden="true">❚❚ </span>Paused
          </>
        ) : hasError ? (
          <>
            <span aria-hidden="true">○ </span>Reconnecting
          </>
        ) : lastOk ? (
          <>
            <span aria-hidden="true" className="text-bid">● </span>Live, updated {fmtRelative(lastOk)}
          </>
        ) : (
          "Connecting"
        )}
      </span>
    </PageHeader>
  );
}

function KpiStrip({ live }: { live: Live }) {
  const candles = live.chart?.candles ?? [];
  const last = candles.length ? candles[candles.length - 1].close : null;
  const change = candles.length ? candles[candles.length - 1].close - candles[0].open : null;
  const s = live.stats;
  const lastEvent = live.feed?.events[0];
  const dir = change === null ? "" : change > 0 ? " ▲" : change < 0 ? " ▼" : "";
  return (
    <div className="stagger grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
      <Kpi label="Last price" value={fmtPrice(last)} sub={live.chart?.priceSource === "quotes" ? "quoted, no trades" : "last trade"} />
      <Kpi
        label="Change, 5 min"
        value={
          <span className={change === null ? "" : change > 0 ? "text-bid" : change < 0 ? "text-ask" : ""}>
            {change === null ? "-" : `${fmtSigned(change)}${dir}`}
          </span>
        }
        sub={change !== null && candles[0].open ? `${fmtSigned((change / candles[0].open) * 100)}%` : undefined}
      />
      <Kpi label="Events" value={fmtInt(s?.totals.events)} sub={s ? `${fmtInt(s.totals.eventsByType.fill)} fills` : undefined} />
      <Kpi label="Alerts" value={fmtInt(s?.totals.alerts)} />
      <Kpi label="Flags" value={<span className={s && s.flags > 0 ? "text-alert" : ""}>{fmtInt(s?.flags)}</span>} />
      <Kpi label="In review" value={fmtInt(s?.reviews)} sub={s ? `${fmtInt(s.openAlerts)} open` : undefined} />
      <Kpi label="Last event" value={lastEvent ? fmtRelative(lastEvent.createdAt) : "-"} sub={lastEvent ? fmtTimeMs(lastEvent.createdAt) : undefined} />
    </div>
  );
}

function DepthLadder({ stats }: { stats: StatsResponse | null }) {
  const book = stats?.orderBook;
  if (!book || (book.bids.length === 0 && book.asks.length === 0)) {
    return <EmptyState title="No resting orders." body="Depth is built from orders placed in the 5 minutes before the latest event." />;
  }
  const max = Math.max(1, ...book.bids.map((l) => l.size), ...book.asks.map((l) => l.size));
  const asks = [...book.asks].reverse();
  const spread = book.asks[0] && book.bids[0] ? book.asks[0].price - book.bids[0].price : null;

  const row = (l: { price: number; size: number; orders: number }, side: "bid" | "ask") => (
    <tr key={`${side}-${l.price}`} className="relative border-b border-seam/50">
      <td className="relative px-2 py-0.5 text-right text-dim">{l.orders}</td>
      <td className="relative px-2 py-0.5 text-right">
        <span
          aria-hidden="true"
          className={`absolute inset-y-0.5 right-0 ${side === "bid" ? "bg-bid/20" : "bg-ask/20"}`}
          style={{ width: `${(l.size / max) * 100}%` }}
        />
        <span className="relative">{fmtInt(l.size)}</span>
      </td>
      <td className={`px-2 py-0.5 text-right ${side === "bid" ? "text-bid" : "text-ask"}`}>
        {fmtPrice(l.price)}
        <span className="sr-only"> {side === "bid" ? "bid" : "offer"}</span>
      </td>
    </tr>
  );

  return (
    <table className="num w-full text-[12px]">
      <caption className="sr-only">Approximate order book: offers above, bids below</caption>
      <thead>
        <tr className="border-b border-seam text-[11px] text-dim">
          <th scope="col" className="px-2 py-1 text-right font-medium">Orders</th>
          <th scope="col" className="px-2 py-1 text-right font-medium">Size</th>
          <th scope="col" className="px-2 py-1 text-right font-medium">Price</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="rowgroup" colSpan={3} className="px-2 pt-1 text-left text-[11px] font-medium text-dim">
            Offers <span aria-hidden="true">▼</span>
          </th>
        </tr>
        {asks.map((l) => row(l, "ask"))}
        <tr className="border-y border-seam bg-panelhi">
          <td colSpan={3} className="px-2 py-0.5 text-right text-[11px] text-dim">
            Spread <span className="num text-text">{spread === null ? "-" : fmtPrice(spread)}</span>
          </td>
        </tr>
        <tr>
          <th scope="rowgroup" colSpan={3} className="px-2 pt-1 text-left text-[11px] font-medium text-dim">
            Bids <span aria-hidden="true">▲</span>
          </th>
        </tr>
        {book.bids.map((l) => row(l, "bid"))}
      </tbody>
    </table>
  );
}

// Tracks which ids were already on screen so only genuinely new rows flash.
function useNewIds(ids: string[] | undefined) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!ids) return;
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const next = new Set(ids.filter((id) => !seen.current!.has(id)));
    ids.forEach((id) => seen.current!.add(id));
    setFresh(next);
  }, [ids]);
  return fresh;
}

function TimeAndSales({ feed }: { feed: FeedResponse | null }) {
  const [tab, setTab] = useState<"trades" | "all">("trades");
  const events = useMemo(
    () => (feed?.events ?? []).filter((e) => tab === "all" || e.eventType === "fill").slice(0, 60),
    [feed, tab],
  );
  const ids = useMemo(() => events.map((e) => e.id), [events]);
  const fresh = useNewIds(ids);

  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Feed filter" className="flex shrink-0 gap-px border-b border-seam">
        {(["trades", "all"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`h-6 px-3 text-[12px] ${tab === t ? "bg-panelhi text-text" : "text-dim hover:text-text"}`}
          >
            {t === "trades" ? "Trades" : "All events"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {events.length === 0 ? (
          <EmptyState title={tab === "trades" ? "No trades yet." : "No events yet."} body="Trades appear here as fills arrive." />
        ) : (
          <table className="w-full text-[12px]">
            <caption className="sr-only">{tab === "trades" ? "Recent trades" : "Recent order events"}, newest first</caption>
            <thead className="sticky top-0 bg-panel">
              <tr className="border-b border-seam text-[11px] text-dim">
                <th scope="col" className="px-2 py-1 text-left font-medium">Time</th>
                {tab === "all" && <th scope="col" className="px-2 py-1 text-left font-medium">Type</th>}
                <th scope="col" className="px-2 py-1 text-left font-medium">Side</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Price</th>
                <th scope="col" className="px-2 py-1 text-right font-medium">Size</th>
                <th scope="col" className="hidden px-2 py-1 text-left font-medium sm:table-cell">Account</th>
              </tr>
            </thead>
            <tbody className="num">
              {events.map((e) => (
                <tr
                  key={e.id}
                  className={`border-b border-seam/50 hover:bg-panelhi ${fresh.has(e.id) ? (e.side === "BUY" ? "flash-bid" : "flash-ask") : ""} ${e.alerts.length ? "outline outline-1 -outline-offset-1 outline-alert" : ""}`}
                >
                  <td className="whitespace-nowrap px-2 py-0.5 text-[11px] text-dim">{fmtTimeMs(e.createdAt)}</td>
                  {tab === "all" && <td className="px-2 py-0.5 font-sans text-[12px]">{e.eventType}</td>}
                  <td className="px-2 py-0.5">
                    <SideTag side={e.side} />
                  </td>
                  <td className="px-2 py-0.5 text-right">{fmtPrice(e.price)}</td>
                  <td className="px-2 py-0.5 text-right">
                    {fmtInt(e.size)}
                    {e.alerts.length > 0 && <span className="sr-only"> (raised an alert)</span>}
                  </td>
                  <td className="hidden px-2 py-0.5 text-dim sm:table-cell">{e.accountId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AlertBlotter({ alerts }: { alerts: AlertsResponse | null }) {
  const ids = useMemo(() => (alerts?.alerts ?? []).map((a) => a.id), [alerts]);
  const list = alerts?.alerts ?? [];
  const fresh = useNewIds(ids);
  if (list.length === 0) {
    return (
      <EmptyState
        title="No alerts on this symbol."
        body="Alerts appear here the moment a rule fires. Try the spoofing or quote stuffing scenario."
      />
    );
  }
  return (
    <table className="w-full text-[12px]">
      <caption className="sr-only">Alerts on this symbol, newest first. Select a row to open its case.</caption>
      <thead className="sticky top-0 bg-panel">
        <tr className="border-b border-seam text-[11px] text-dim">
          <th scope="col" className="px-2 py-1 text-left font-medium">Time</th>
          <th scope="col" className="px-2 py-1 text-left font-medium">Rule</th>
          <th scope="col" className="px-2 py-1 text-left font-medium">Verdict</th>
          <th scope="col" className="px-2 py-1 text-right font-medium">Metric</th>
          <th scope="col" className="hidden px-2 py-1 text-left font-medium md:table-cell">Reason</th>
          <th scope="col" className="px-2 py-1 text-left font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {list.map((a) => (
          <tr
            key={a.id}
            className={`border-b border-seam/50 hover:bg-panelhi ${a.verdict === "FLAG" ? "outline outline-1 -outline-offset-1 outline-alert" : ""} ${fresh.has(a.id) ? "flash-alert" : ""}`}
          >
            <td className="num whitespace-nowrap px-2 py-1 text-[11px] text-dim">{fmtTimeMs(a.createdAt)}</td>
            <td className="px-2 py-1">
              <Link href={`/alerts/${a.id}`} className="text-[13px] text-text underline-offset-2 hover:underline">
                {alertTypeLabel(a.alertType)}
                <span className="sr-only">, open case</span>
              </Link>
            </td>
            <td className="px-2 py-1">
              <VerdictBadge verdict={a.verdict} />
            </td>
            <td className="num px-2 py-1 text-right">{fmtMetric(a.alertType, a.metricValue)}</td>
            <td className="hidden max-w-[28rem] truncate px-2 py-1 text-dim md:table-cell" title={a.reason}>
              {a.reason}
            </td>
            <td className="whitespace-nowrap px-2 py-1">
              <StatusTag status={a.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Polite, batched announcement of new alerts, at most once every 5s.
function useAlertAnnouncer(alerts: AlertsResponse | null, symbol: string | null) {
  const known = useRef<Set<string> | null>(null);
  const pending = useRef<string[]>([]);
  const lastAt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [text, setText] = useState("");

  useEffect(() => {
    known.current = null;
    pending.current = [];
  }, [symbol]);

  useEffect(() => {
    if (!alerts) return;
    if (known.current === null) {
      known.current = new Set(alerts.alerts.map((a) => a.id));
      return;
    }
    for (const a of alerts.alerts) {
      if (!known.current.has(a.id)) {
        known.current.add(a.id);
        pending.current.push(`${alertTypeLabel(a.alertType)} ${a.verdict}`);
      }
    }
    if (pending.current.length === 0) return;
    const flush = () => {
      const items = pending.current;
      pending.current = [];
      lastAt.current = Date.now();
      setText(`${items.length} new alert${items.length > 1 ? "s" : ""} on ${symbol}: ${items.join(", ")}`);
    };
    const wait = ANNOUNCE_GAP_MS - (Date.now() - lastAt.current);
    clearTimeout(timer.current);
    if (wait <= 0) flush();
    else timer.current = setTimeout(flush, wait);
  }, [alerts, symbol]);

  useEffect(() => () => clearTimeout(timer.current), []);
  return text;
}
