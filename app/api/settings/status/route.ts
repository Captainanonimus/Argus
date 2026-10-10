import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getKeySources } from "@/lib/keys";
import { logRouteError, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 5000;

async function dbReachable(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), DB_TIMEOUT_MS);
    });
    await Promise.race([prisma.$queryRaw`SELECT 1`, timeout]);
    return true;
  } catch (err) {
    logRouteError("GET /api/settings/status db check", err);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Booleans and key sources only - never key values.
export async function GET() {
  try {
    const [sources, db] = await Promise.all([getKeySources(), dbReachable()]);
    return NextResponse.json({
      openrouter: sources.openrouter !== null,
      tinyfish: sources.tinyfish !== null,
      db,
      sources,
    });
  } catch (err) {
    return serverError("GET /api/settings/status", err);
  }
}
