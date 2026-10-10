import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { intParam, optionalSymbolParam, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

// Newest events first, each with any alerts it raised.
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const symbol = optionalSymbolParam(params);
    if (!symbol.ok) return symbol.res;
    const limit = intParam(params, "limit", 50, 1, 200);
    if (!limit.ok) return limit.res;

    const events = await prisma.orderEvent.findMany({
      where: symbol.value ? { symbol: symbol.value } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit.value,
      include: {
        alerts: {
          select: {
            id: true,
            alertType: true,
            verdict: true,
            status: true,
            metricValue: true,
            reason: true,
            createdAt: true,
          },
        },
      },
    });

    return NextResponse.json({ events });
  } catch (err) {
    return serverError("GET /api/feed", err);
  }
}
