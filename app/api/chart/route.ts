import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { intParam, jsonError, optionalSymbolParam, serverError } from "@/lib/api";
import { EVENT_TYPES } from "@/lib/eventTypes";

export const dynamic = "force-dynamic";

const [, , FILL] = EVENT_TYPES;
const MAX_ROWS = 20_000;

type Candle = {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// 1-second candles over the last `seconds` (default 300) plus alert markers.
// Candles use fill prices when the window has fills, otherwise quoted prices.
// No data -> empty arrays, never an error.
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const symbol = optionalSymbolParam(params);
    if (!symbol.ok) return symbol.res;
    if (!symbol.value) return jsonError(400, "symbol is required.");
    const seconds = intParam(params, "seconds", 300, 1, 3600);
    if (!seconds.ok) return seconds.res;

    const since = new Date(Date.now() - seconds.value * 1000);
    const rows = await prisma.orderEvent.findMany({
      where: { symbol: symbol.value, createdAt: { gte: since } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: MAX_ROWS,
      select: {
        eventType: true,
        price: true,
        size: true,
        createdAt: true,
        alerts: { select: { id: true, verdict: true, alertType: true } },
      },
    });

    const fills = rows.filter((r) => r.eventType === FILL);
    const priced = fills.length > 0 ? fills : rows;

    const candles: Candle[] = [];
    for (const r of priced) {
      const time = Math.floor(r.createdAt.getTime() / 1000);
      const last = candles[candles.length - 1];
      if (last && last.time === time) {
        last.high = Math.max(last.high, r.price);
        last.low = Math.min(last.low, r.price);
        last.close = r.price;
        last.volume += r.size;
      } else {
        candles.push({ time, open: r.price, high: r.price, low: r.price, close: r.price, volume: r.size });
      }
    }

    const markers = rows.flatMap((r) =>
      r.alerts.map((a) => ({
        time: Math.floor(r.createdAt.getTime() / 1000),
        verdict: a.verdict,
        alertType: a.alertType,
        alertId: a.id,
      })),
    );

    return NextResponse.json({
      symbol: symbol.value,
      seconds: seconds.value,
      priceSource: rows.length === 0 ? null : fills.length > 0 ? "fills" : "quotes",
      candles,
      markers,
    });
  } catch (err) {
    return serverError("GET /api/chart", err);
  }
}
