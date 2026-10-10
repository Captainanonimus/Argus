import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { optionalSymbolParam, serverError } from "@/lib/api";
import { ALERT_STATUSES, EVENT_TYPES, SIDES, VERDICTS } from "@/lib/eventTypes";

export const dynamic = "force-dynamic";

const [PLACE] = EVENT_TYPES;
const [BUY, SELL] = SIDES;
const [, REVIEW, FLAG] = VERDICTS;
const [OPEN] = ALERT_STATUSES;

const BOOK_LOOKBACK_MS = 5 * 60_000;
const BOOK_MAX_ROWS = 2000;
const BOOK_LEVELS = 5;

type Level = { price: number; size: number; orders: number };

// Totals for one symbol (or all symbols when none is given), plus an
// order-book snapshot when a symbol is given.
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const symbolParam = optionalSymbolParam(params);
    if (!symbolParam.ok) return symbolParam.res;
    const symbol = symbolParam.value;

    const eventWhere: Prisma.OrderEventWhereInput = symbol ? { symbol } : {};
    const alertWhere: Prisma.AlertWhereInput = symbol ? { orderEvent: { symbol } } : {};

    const [byType, alerts, flags, reviews, openAlerts, orderBook] = await Promise.all([
      prisma.orderEvent.groupBy({ by: ["eventType"], where: eventWhere, _count: { _all: true } }),
      prisma.alert.count({ where: alertWhere }),
      prisma.alert.count({ where: { ...alertWhere, verdict: FLAG } }),
      prisma.alert.count({ where: { ...alertWhere, verdict: REVIEW } }),
      prisma.alert.count({ where: { ...alertWhere, status: OPEN } }),
      symbol ? orderBookSnapshot(symbol) : Promise.resolve(null),
    ]);

    const eventsByType = Object.fromEntries(EVENT_TYPES.map((t) => [t, 0])) as Record<
      string,
      number
    >;
    let events = 0;
    for (const g of byType) {
      eventsByType[g.eventType] = g._count._all;
      events += g._count._all;
    }

    return NextResponse.json({
      symbol,
      totals: { events, eventsByType, alerts },
      flags,
      reviews,
      openAlerts,
      orderBook,
    });
  } catch (err) {
    return serverError("GET /api/stats", err);
  }
}

// Approximate book from place events in the 5 minutes before the symbol's
// latest event (the schema has no order ids, so cancels/fills are not netted).
async function orderBookSnapshot(symbol: string) {
  const latest = await prisma.orderEvent.findFirst({
    where: { symbol },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!latest) return { asOf: null, bids: [] as Level[], asks: [] as Level[] };

  const rows = await prisma.orderEvent.findMany({
    where: {
      symbol,
      eventType: PLACE,
      createdAt: { gte: new Date(latest.createdAt.getTime() - BOOK_LOOKBACK_MS) },
    },
    orderBy: { createdAt: "desc" },
    take: BOOK_MAX_ROWS,
    select: { side: true, price: true, size: true },
  });

  const levels = { [BUY]: new Map<number, Level>(), [SELL]: new Map<number, Level>() };
  for (const r of rows) {
    const book = r.side === BUY ? levels[BUY] : r.side === SELL ? levels[SELL] : null;
    if (!book) continue;
    const level = book.get(r.price) ?? { price: r.price, size: 0, orders: 0 };
    level.size += r.size;
    level.orders++;
    book.set(r.price, level);
  }

  return {
    asOf: latest.createdAt,
    bids: Array.from(levels[BUY].values())
      .sort((a, b) => b.price - a.price)
      .slice(0, BOOK_LEVELS),
    asks: Array.from(levels[SELL].values())
      .sort((a, b) => a.price - b.price)
      .slice(0, BOOK_LEVELS),
  };
}
