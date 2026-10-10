import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isPlainObject, jsonError, readJsonBody, serverError } from "@/lib/api";
import { ALERT_EVENT_SELECT } from "@/lib/alertQuery";
import { ALERT_STATUSES, type AlertStatus } from "@/lib/eventTypes";

export const dynamic = "force-dynamic";

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BEFORE_MS = 30_000;
const AFTER_MS = 10_000;
const TIMELINE_MAX = 500;
const NOTE_MAX = 2000;

type Ctx = { params: { id: string } };

// One alert, its event, and the symbol's events from 30s before to 10s after
// it (oldest first) for a timeline.
export async function GET(_req: Request, { params }: Ctx) {
  try {
    if (!ID_RE.test(params.id)) return jsonError(400, "Invalid alert id.");

    const alert = await prisma.alert.findUnique({
      where: { id: params.id },
      include: { orderEvent: { select: ALERT_EVENT_SELECT } },
    });
    if (!alert) return jsonError(404, "Alert not found.");

    const t = alert.orderEvent.createdAt.getTime();
    const timeline = await prisma.orderEvent.findMany({
      where: {
        symbol: alert.orderEvent.symbol,
        createdAt: { gte: new Date(t - BEFORE_MS), lte: new Date(t + AFTER_MS) },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: TIMELINE_MAX,
      select: {
        ...ALERT_EVENT_SELECT,
        alerts: { select: { id: true, alertType: true, verdict: true } },
      },
    });

    const { orderEvent: event, ...rest } = alert;
    return NextResponse.json({
      alert: rest,
      event,
      timeline,
      window: { beforeMs: BEFORE_MS, afterMs: AFTER_MS },
    });
  } catch (err) {
    return serverError("GET /api/alerts/[id]", err);
  }
}

// Update triage fields: { status?, note? } - at least one is required.
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    if (!ID_RE.test(params.id)) return jsonError(400, "Invalid alert id.");

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.res;
    const body = parsed.body;
    if (!isPlainObject(body)) return jsonError(400, "Body must be a JSON object.");

    const allowed = new Set(["status", "note"]);
    const unknown = Object.keys(body).filter((k) => !allowed.has(k));
    if (unknown.length > 0) return jsonError(400, `Unknown fields: ${unknown.join(", ")}`);

    const data: { status?: AlertStatus; note?: string } = {};
    if (body.status !== undefined) {
      const raw = typeof body.status === "string" ? body.status.trim().toLowerCase() : "";
      const status = ALERT_STATUSES.find((s) => s === raw);
      if (!status) return jsonError(400, `status must be one of ${ALERT_STATUSES.join(", ")}`);
      data.status = status;
    }
    if (body.note !== undefined) {
      if (typeof body.note !== "string") return jsonError(400, "note must be a string.");
      if (body.note.length > NOTE_MAX) {
        return jsonError(400, `note must be at most ${NOTE_MAX} characters.`);
      }
      data.note = body.note;
    }
    if (data.status === undefined && data.note === undefined) {
      return jsonError(400, "Provide status and/or note.");
    }

    try {
      const alert = await prisma.alert.update({ where: { id: params.id }, data });
      return NextResponse.json({ alert });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        return jsonError(404, "Alert not found.");
      }
      throw err;
    }
  } catch (err) {
    return serverError("PATCH /api/alerts/[id]", err);
  }
}
