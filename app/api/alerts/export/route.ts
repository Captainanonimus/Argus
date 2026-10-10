import { prisma } from "@/lib/prisma";
import { intParam, serverError } from "@/lib/api";
import { ALERT_EVENT_SELECT, ALERT_ORDER, parseAlertFilters } from "@/lib/alertQuery";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "alertId",
  "createdAt",
  "updatedAt",
  "symbol",
  "alertType",
  "verdict",
  "status",
  "metricValue",
  "reason",
  "note",
  "eventId",
  "eventType",
  "side",
  "price",
  "size",
  "accountId",
  "eventCreatedAt",
] as const;

// RFC 4180 quoting, plus a leading apostrophe on text cells that a
// spreadsheet would otherwise run as a formula.
function csvCell(value: string | number | Date): string {
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Same filters as GET /api/alerts, as a CSV download (up to `limit` rows).
export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const filters = parseAlertFilters(params);
    if (!filters.ok) return filters.res;
    const limit = intParam(params, "limit", 5000, 1, 10_000);
    if (!limit.ok) return limit.res;

    const alerts = await prisma.alert.findMany({
      where: filters.where,
      orderBy: ALERT_ORDER,
      take: limit.value,
      include: { orderEvent: { select: ALERT_EVENT_SELECT } },
    });

    const lines = [COLUMNS.join(",")];
    for (const a of alerts) {
      const e = a.orderEvent;
      const row: Record<(typeof COLUMNS)[number], string | number | Date> = {
        alertId: a.id,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
        symbol: e.symbol,
        alertType: a.alertType,
        verdict: a.verdict,
        status: a.status,
        metricValue: a.metricValue,
        reason: a.reason,
        note: a.note,
        eventId: e.id,
        eventType: e.eventType,
        side: e.side,
        price: e.price,
        size: e.size,
        accountId: e.accountId,
        eventCreatedAt: e.createdAt,
      };
      lines.push(COLUMNS.map((c) => csvCell(row[c])).join(","));
    }

    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
    return new Response(lines.join("\r\n") + "\r\n", {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="argus-alerts-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return serverError("GET /api/alerts/export", err);
  }
}
