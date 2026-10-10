import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const MAX_SYMBOLS = 200;

// Distinct symbols with their latest price and total event count.
export async function GET() {
  try {
    const groups = await prisma.orderEvent.groupBy({
      by: ["symbol"],
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { symbol: "asc" },
      take: MAX_SYMBOLS,
    });

    const symbols = await Promise.all(
      groups.map(async (g) => {
        const last = await prisma.orderEvent.findFirst({
          where: { symbol: g.symbol },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          select: { price: true, createdAt: true },
        });
        return {
          symbol: g.symbol,
          lastPrice: last?.price ?? null,
          lastEventAt: last?.createdAt ?? g._max.createdAt,
          eventCount: g._count._all,
        };
      }),
    );

    return NextResponse.json({ symbols });
  } catch (err) {
    return serverError("GET /api/symbols", err);
  }
}
