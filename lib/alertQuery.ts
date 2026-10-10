import type { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { ALERT_STATUSES, ALERT_TYPES, VERDICTS } from "./eventTypes";
import { jsonError, optionalSymbolParam } from "./api";

// Filters shared by GET /api/alerts and GET /api/alerts/export.

const MAX_Q = 200;

export function parseAlertFilters(
  params: URLSearchParams,
): { ok: true; where: Prisma.AlertWhereInput } | { ok: false; res: NextResponse } {
  const where: Prisma.AlertWhereInput = {};

  const status = params.get("status")?.trim().toLowerCase();
  if (status) {
    const match = ALERT_STATUSES.find((s) => s === status);
    if (!match) return bad(`status must be one of ${ALERT_STATUSES.join(", ")}`);
    where.status = match;
  }

  const verdict = params.get("verdict")?.trim().toUpperCase();
  if (verdict) {
    const match = VERDICTS.find((v) => v === verdict);
    if (!match) return bad(`verdict must be one of ${VERDICTS.join(", ")}`);
    where.verdict = match;
  }

  const type = params.get("type")?.trim().toLowerCase();
  if (type) {
    const match = ALERT_TYPES.find((t) => t === type);
    if (!match) return bad(`type must be one of ${ALERT_TYPES.join(", ")}`);
    where.alertType = match;
  }

  const symbol = optionalSymbolParam(params);
  if (!symbol.ok) return symbol;
  if (symbol.value) where.orderEvent = { symbol: symbol.value };

  const q = params.get("q")?.trim();
  if (q) {
    if (q.length > MAX_Q) return bad(`q must be at most ${MAX_Q} characters`);
    where.OR = [
      { reason: { contains: q, mode: "insensitive" } },
      { note: { contains: q, mode: "insensitive" } },
      { orderEvent: { accountId: { contains: q, mode: "insensitive" } } },
      { orderEvent: { symbol: { contains: q, mode: "insensitive" } } },
    ];
  }

  return { ok: true, where };
}

function bad(message: string) {
  return { ok: false as const, res: jsonError(400, message) };
}

// Newest first; id breaks ties so cursor pagination is stable.
export const ALERT_ORDER: Prisma.AlertOrderByWithRelationInput[] = [
  { createdAt: "desc" },
  { id: "desc" },
];

export const ALERT_EVENT_SELECT = {
  id: true,
  symbol: true,
  accountId: true,
  side: true,
  price: true,
  size: true,
  eventType: true,
  createdAt: true,
} satisfies Prisma.OrderEventSelect;
