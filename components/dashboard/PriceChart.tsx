"use client";

import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, ChartResponse } from "@/lib/clientApi";
import { alertTypeLabel, fmtInt, fmtPrice, fmtSigned, fmtTime } from "@/lib/format";

const C = {
  panel: "#12151C",
  seam: "#232833",
  amber: "#FFA028",
  bid: "#2FBF71",
  ask: "#E5484D",
  alert: "#3DDBD9",
  bidVol: "rgba(47, 191, 113, 0.4)",
  askVol: "rgba(229, 72, 77, 0.4)",
};

const MARKER_CODE: Record<string, string> = {
  quote_stuffing: "QS",
  spoofing: "SP",
  book_imbalance: "BI",
};

type Readout = Candle & { change: number };

function toTime(t: number) {
  return t as UTCTimestamp;
}

function volumePoint(c: Candle) {
  return { time: toTime(c.time), value: c.volume, color: c.close >= c.open ? C.bidVol : C.askVol };
}

function candlePoint(c: Candle) {
  return { time: toTime(c.time), open: c.open, high: c.high, low: c.low, close: c.close };
}

// Snaps each alert to the latest candle at or before it (alerts can sit on
// quote events while candles are built from fills).
function buildMarkers(data: ChartResponse): SeriesMarker<Time>[] {
  const times = data.candles.map((c) => c.time);
  if (times.length === 0) return [];
  const seen = new Set<string>();
  const out: SeriesMarker<Time>[] = [];
  for (const m of data.markers) {
    if (seen.has(m.alertId)) continue;
    seen.add(m.alertId);
    let snapped = times[0];
    for (const t of times) {
      if (t <= m.time) snapped = t;
      else break;
    }
    const flag = m.verdict === "FLAG";
    out.push({
      id: m.alertId,
      time: toTime(snapped),
      position: "aboveBar",
      shape: flag ? "arrowDown" : "circle",
      color: C.alert,
      text: `${MARKER_CODE[m.alertType] ?? "AL"} ${m.verdict}`,
    });
  }
  return out.sort((a, b) => (a.time as number) - (b.time as number));
}

function monoFamily(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
    return v ? `${v}, ui-monospace, monospace` : "ui-monospace, monospace";
  } catch {
    return "ui-monospace, monospace";
  }
}

export function PriceChart({
  data,
  onAlertClick,
  showTable,
  fitSignal,
}: {
  data: ChartResponse | null;
  onAlertClick: (alertId: string) => void;
  showTable: boolean;
  fitSignal: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lastLineRef = useRef<IPriceLine | null>(null);
  const stateRef = useRef<{ symbol: string | null; lastTime: number | null }>({ symbol: null, lastTime: null });
  const markerMapRef = useRef<Map<number, string>>(new Map());
  const clickRef = useRef(onAlertClick);
  clickRef.current = onAlertClick;

  const [hover, setHover] = useState<Readout | null>(null);
  const [last, setLast] = useState<Readout | null>(null);

  // Create once; dispose on unmount.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: C.panel },
        textColor: C.amber,
        fontFamily: monoFamily(),
        fontSize: 11,
        attributionLogo: true,
        panes: { separatorColor: C.seam, separatorHoverColor: C.seam, enableResize: false },
      },
      grid: { vertLines: { color: C.seam }, horzLines: { color: C.seam } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: C.amber, labelBackgroundColor: C.amber, width: 1, style: 3 },
        horzLine: { color: C.amber, labelBackgroundColor: C.amber, width: 1, style: 3 },
      },
      rightPriceScale: { borderColor: C.seam },
      timeScale: {
        borderColor: C.seam,
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 4,
        tickMarkFormatter: (t: Time) => fmtTime((t as number) * 1000),
      },
      localization: { timeFormatter: (t: Time) => fmtTime((t as number) * 1000) },
    });

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "rgba(0, 0, 0, 0)",
      downColor: C.ask,
      borderUpColor: C.bid,
      borderDownColor: C.ask,
      wickUpColor: C.bid,
      wickDownColor: C.ask,
      lastValueVisible: false,
      priceLineVisible: false,
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    const volume = chart.addSeries(
      HistogramSeries,
      { priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false },
      1,
    );
    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    panes[1]?.setStretchFactor(1);

    const markers = createSeriesMarkers(candles, []);

    const onMove = (p: MouseEventParams<Time>) => {
      const bar = p.seriesData.get(candles) as { open: number; high: number; low: number; close: number } | undefined;
      const vol = p.seriesData.get(volume) as { value: number } | undefined;
      if (!p.time || !bar) {
        setHover(null);
        return;
      }
      setHover({
        time: p.time as number,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: vol?.value ?? 0,
        change: bar.close - bar.open,
      });
    };
    const onClick = (p: MouseEventParams<Time>) => {
      if (!p.time) return;
      const id = markerMapRef.current.get(p.time as number);
      if (id) clickRef.current(id);
    };
    chart.subscribeCrosshairMove(onMove);
    chart.subscribeClick(onClick);

    chartRef.current = chart;
    candleRef.current = candles;
    volumeRef.current = volume;
    markersRef.current = markers;

    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.unsubscribeClick(onClick);
      markers.detach();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
      lastLineRef.current = null;
      stateRef.current = { symbol: null, lastTime: null };
    };
  }, []);

  // Apply new data: full reset on symbol change or when the series went
  // backwards (data reset); otherwise update() only the changed candles.
  useEffect(() => {
    const candles = candleRef.current;
    const volume = volumeRef.current;
    const chart = chartRef.current;
    if (!candles || !volume || !chart || !data) return;

    const st = stateRef.current;
    const list = data.candles;
    const newest = list.length ? list[list.length - 1].time : null;
    const reset = st.symbol !== data.symbol || newest === null || st.lastTime === null || newest < st.lastTime;

    if (reset) {
      candles.setData(list.map(candlePoint));
      volume.setData(list.map(volumePoint));
      if (list.length) chart.timeScale().fitContent();
    } else {
      for (const c of list) {
        if (c.time < (st.lastTime as number)) continue;
        candles.update(candlePoint(c));
        volume.update(volumePoint(c));
      }
    }
    stateRef.current = { symbol: data.symbol, lastTime: newest };

    const markers = buildMarkers(data);
    markersRef.current?.setMarkers(markers);
    markerMapRef.current = new Map(markers.map((m) => [m.time as number, String(m.id)]));

    const tail = list[list.length - 1];
    if (tail) {
      if (!lastLineRef.current) {
        lastLineRef.current = candles.createPriceLine({
          price: tail.close,
          color: C.amber,
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          axisLabelColor: C.amber,
          axisLabelTextColor: "#0A0C10",
          title: "Last",
        });
      } else {
        lastLineRef.current.applyOptions({ price: tail.close });
      }
      const first = list[0];
      setLast({ ...tail, change: tail.close - first.open });
    } else {
      if (lastLineRef.current) {
        candles.removePriceLine(lastLineRef.current);
        lastLineRef.current = null;
      }
      setLast(null);
    }
  }, [data]);

  useEffect(() => {
    if (fitSignal > 0) chartRef.current?.timeScale().fitContent();
  }, [fitSignal]);

  const shown = hover ?? last;
  const empty = !!data && data.candles.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="num flex h-6 shrink-0 items-center gap-3 overflow-hidden border-b border-seam px-2 text-[11px]" aria-live="off">
        {shown ? (
          <>
            <span className="text-dim">{fmtTime(shown.time * 1000)}</span>
            <span>
              <span className="text-dim">O </span>
              {fmtPrice(shown.open)}
            </span>
            <span>
              <span className="text-dim">H </span>
              {fmtPrice(shown.high)}
            </span>
            <span>
              <span className="text-dim">L </span>
              {fmtPrice(shown.low)}
            </span>
            <span>
              <span className="text-dim">C </span>
              {fmtPrice(shown.close)}
            </span>
            <span className="hidden sm:inline">
              <span className="text-dim">V </span>
              {fmtInt(shown.volume)}
            </span>
            <span className={shown.change > 0 ? "text-bid" : shown.change < 0 ? "text-ask" : "text-dim"}>
              {fmtSigned(shown.change)} {shown.change > 0 ? "▲" : shown.change < 0 ? "▼" : ""}
              <span className="sr-only">{hover ? "for this bar" : "over the window"}</span>
            </span>
            {data?.priceSource && (
              <span className="ml-auto hidden text-dim md:inline">
                {data.priceSource === "fills" ? "Trade prices" : "Quote prices"}, 1s bars
              </span>
            )}
          </>
        ) : (
          <span className="text-dim">No bars in the last 5 minutes</span>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={containerRef}
          className={`absolute inset-0 ${showTable ? "invisible" : ""}`}
          role="img"
          aria-label={
            last
              ? `Price chart, last ${fmtPrice(last.close)}, ${fmtSigned(last.change)} over the window. Alert markers: ${data?.markers.length ?? 0}. Use the Table button for the data.`
              : "Price chart with no data"
          }
        />
        {empty && !showTable && (
          <p className="pointer-events-none absolute left-3 top-3 max-w-[40ch] text-[13px] text-dim">
            No trades or quotes on this symbol in the last 5 minutes. Run a scenario to stream new bars.
          </p>
        )}
        {showTable && data && <OhlcTable data={data} />}
      </div>
    </div>
  );
}

function OhlcTable({ data }: { data: ChartResponse }) {
  const rows = data.candles.slice(-60).reverse();
  return (
    <div className="absolute inset-0 overflow-auto">
      <table className="w-full text-[12px]">
        <caption className="sr-only">Last {rows.length} one-second bars for {data.symbol}, newest first</caption>
        <thead className="sticky top-0 bg-panel">
          <tr className="border-b border-seam font-condensed text-[11px] text-dim">
            <th scope="col" className="px-2 py-1 text-left font-medium">Time</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">Open</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">High</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">Low</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">Close</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">Volume</th>
            <th scope="col" className="px-2 py-1 text-left font-medium">Alerts</th>
          </tr>
        </thead>
        <tbody className="num">
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className="px-2 py-3 text-dim">No bars.</td>
            </tr>
          )}
          {rows.map((c) => {
            const alerts = data.markers.filter((m) => m.time >= c.time && m.time < c.time + 1);
            return (
              <tr key={c.time} className="border-b border-seam/60 hover:bg-panelhi">
                <td className="px-2 py-0.5 text-dim">{fmtTime(c.time * 1000)}</td>
                <td className="px-2 py-0.5 text-right">{fmtPrice(c.open)}</td>
                <td className="px-2 py-0.5 text-right">{fmtPrice(c.high)}</td>
                <td className="px-2 py-0.5 text-right">{fmtPrice(c.low)}</td>
                <td className={`px-2 py-0.5 text-right ${c.close >= c.open ? "text-bid" : "text-ask"}`}>
                  {fmtPrice(c.close)} <span aria-hidden="true">{c.close >= c.open ? "▲" : "▼"}</span>
                </td>
                <td className="px-2 py-0.5 text-right">{fmtInt(c.volume)}</td>
                <td className="px-2 py-0.5 text-alert">
                  {alerts.map((a) => `${alertTypeLabel(a.alertType)} ${a.verdict}`).join(", ")}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
