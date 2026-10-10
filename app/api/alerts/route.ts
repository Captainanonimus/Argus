import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { intParam, jsonError, serverError } from "@/lib/api";
import { ALERT_EVENT_SELECT, ALERT_ORDER, parseAlertFilters } from "@/lib/alertQuery";

export const dynamic = "force-dynamic";

const CURSOR_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Filtered alert list, newest first, with cursor pagination: pass the
// previous response's nextCursor as ?cursor= to get the next page.
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const filters = parseAlertFilters(params);
    if (!filters.ok) return filters.res;
    const limit = intParam(params, "limit", 50, 1, 200);
    if (!limit.ok) return limit.res;

    const cursor = params.get("cursor")?.trim() || null;
    if (cursor && !CURSOR_RE.test(cursor)) return jsonError(400, "Invalid cursor.");

    const rows = await prisma.alert.findMany({
      where: filters.where,
      orderBy: ALERT_ORDER,
      take: limit.value + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { orderEvent: { select: ALERT_EVENT_SELECT } },
    });

    const hasMore = rows.length > limit.value;
    const alerts = hasMore ? rows.slice(0, limit.value) : rows;
    return NextResponse.json({
      alerts,
      nextCursor: hasMore ? alerts[alerts.length - 1].id : null,
    });
  } catch (err) {
    return serverError("GET /api/alerts", err);
  }
}
