import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { evaluateEvent } from "@/lib/surveillanceEngine";
import {
  isPlainObject,
  jsonError,
  logRouteError,
  parseEventInput,
  readJsonBody,
  serverError,
  type EventInput,
} from "@/lib/api";
import { VERDICTS, type AlertType, type Verdict } from "@/lib/eventTypes";

export const maxDuration = 60;

const MAX_BATCH = 200;

type BatchResult =
  | {
      index: number;
      ok: true;
      eventId: string;
      symbol: string;
      verdict: Verdict;
      reason: string;
      alertTypes: AlertType[];
    }
  | { index: number; ok: false; error: string };

// Ingest up to 200 events. The whole batch is validated first; events are then
// saved and evaluated one at a time, in order, because each evaluation reads
// the window that earlier events in the batch just wrote.
export async function POST(req: Request) {
  try {
    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.res;

    const list = Array.isArray(parsed.body)
      ? parsed.body
      : isPlainObject(parsed.body) && Array.isArray(parsed.body.events)
        ? parsed.body.events
        : null;
    if (!list) return jsonError(400, "Body must be an array of events or { events: [...] }.");
    if (list.length === 0) return jsonError(400, "Batch is empty.");
    if (list.length > MAX_BATCH) return jsonError(400, `Batch exceeds ${MAX_BATCH} events.`);

    const inputs: EventInput[] = [];
    const invalid: { index: number; errors: string[] }[] = [];
    list.forEach((raw, index) => {
      const r = parseEventInput(raw);
      if (r.ok) inputs.push(r.value);
      else invalid.push({ index, errors: r.errors });
    });
    if (invalid.length > 0) {
      return jsonError(400, "Invalid events in batch - nothing was saved.", invalid);
    }

    const results: BatchResult[] = [];
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index];
      try {
        const event = await prisma.orderEvent.create({ data: input });
        const r = await evaluateEvent(event);
        results.push({
          index,
          ok: true,
          eventId: event.id,
          symbol: event.symbol,
          verdict: r.verdict,
          reason: r.reason,
          alertTypes: r.alertTypes,
        });
      } catch (err) {
        logRouteError("POST /api/events/batch item", err);
        results.push({ index, ok: false, error: "event could not be saved" });
      }
    }

    const byVerdict = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as Record<Verdict, number>;
    let failed = 0;
    for (const r of results) {
      if (r.ok) byVerdict[r.verdict]++;
      else failed++;
    }
    const summary = {
      total: results.length,
      processed: results.length - failed,
      failed,
      ...byVerdict,
    };

    return NextResponse.json(
      { results, summary },
      { status: failed === results.length ? 500 : 200 },
    );
  } catch (err) {
    return serverError("POST /api/events/batch", err);
  }
}
