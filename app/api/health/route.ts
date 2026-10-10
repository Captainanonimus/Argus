import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logRouteError } from "@/lib/api";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 5000;

// Liveness plus a trivial database query. Always 200 with { ok, db }; never throws.
export async function GET() {
  let db = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
    });
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    db = true;
  } catch (err) {
    logRouteError("GET /api/health db check", err);
  } finally {
    clearTimeout(timer);
  }
  return NextResponse.json({ ok: true, db }, { headers: { "Cache-Control": "no-store" } });
}
