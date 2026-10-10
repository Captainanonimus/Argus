import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { serverError } from "@/lib/api";

const DEMO_PREFIX = "SIM";

// Clears simulated data only: events (and their alerts) whose symbol starts
// with "SIM". Every other symbol is untouched.
export async function POST() {
  try {
    const where = { symbol: { startsWith: DEMO_PREFIX } };
    const [alerts, events] = await prisma.$transaction([
      prisma.alert.deleteMany({ where: { orderEvent: where } }),
      prisma.orderEvent.deleteMany({ where }),
    ]);
    return NextResponse.json({
      ok: true,
      prefix: DEMO_PREFIX,
      deleted: { events: events.count, alerts: alerts.count },
    });
  } catch (err) {
    return serverError("POST /api/demo/reset", err);
  }
}
