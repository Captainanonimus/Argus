import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { evaluateEvent } from "@/lib/surveillanceEngine";
import { jsonError, parseEventInput, readJsonBody, serverError } from "@/lib/api";

export const maxDuration = 60;

// Ingest one order event: save it, run the surveillance engine, return the verdict.
export async function POST(req: Request) {
  try {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.res;

    const input = parseEventInput(parsed.body);
    if (!input.ok) return jsonError(400, "Invalid event.", input.errors);

    const event = await prisma.orderEvent.create({ data: input.value });
    const result = await evaluateEvent(event);

    return NextResponse.json(
      {
        event,
        verdict: result.verdict,
        reason: result.reason,
        alertTypes: result.alertTypes,
      },
      { status: 201 },
    );
  } catch (err) {
    return serverError("POST /api/events", err);
  }
}
