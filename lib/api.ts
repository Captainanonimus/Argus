import { NextResponse } from "next/server";
import { EVENT_TYPES, SIDES, type EventType, type Side } from "./eventTypes";

// Shared helpers for the JSON route handlers: consistent error bodies,
// explicit input validation, and logging that never includes request data.

export function jsonError(status: number, error: string, details?: unknown) {
  return NextResponse.json(details === undefined ? { error } : { error, details }, { status });
}

// Logs only the route and the error's name/code - never bodies or keys.
export function logRouteError(route: string, err: unknown) {
  const code =
    err && typeof err === "object" && "code" in err && typeof err.code === "string"
      ? ` ${err.code}`
      : "";
  const name = err instanceof Error ? err.name : typeof err;
  console.error(`[api] ${route} failed: ${name}${code}`);
}

export function serverError(route: string, err: unknown) {
  logRouteError(route, err);
  return jsonError(500, "Internal error - the request could not be completed.");
}

const MAX_BODY_BYTES = 1_000_000;

export async function readJsonBody(
  req: Request,
): Promise<{ ok: true; body: unknown } | { ok: false; res: NextResponse }> {
  const tooLarge = () => ({ ok: false as const, res: jsonError(413, "Request body is too large.") });
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) return tooLarge();
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return tooLarge();
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, res: jsonError(400, "Request body must be valid JSON.") };
  }
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// --- Query parameters ------------------------------------------------------

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;

// Uppercases and checks a ticker. Returns null when invalid.
export function normalizeSymbol(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : null;
}

type Parsed<T> = { ok: true; value: T } | { ok: false; res: NextResponse };

// Optional symbol query param: absent/empty -> null, invalid -> 400.
export function optionalSymbolParam(params: URLSearchParams): Parsed<string | null> {
  const raw = params.get("symbol");
  if (raw === null || raw.trim() === "") return { ok: true, value: null };
  const symbol = normalizeSymbol(raw);
  if (!symbol) return { ok: false, res: jsonError(400, "Invalid symbol.") };
  return { ok: true, value: symbol };
}

// Integer query param with a default and inclusive bounds; out-of-range -> 400.
export function intParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
  max: number,
): Parsed<number> {
  const raw = params.get(name);
  if (raw === null || raw.trim() === "") return { ok: true, value: fallback };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    return {
      ok: false,
      res: jsonError(400, `${name} must be an integer between ${min} and ${max}.`),
    };
  }
  return { ok: true, value: n };
}

// --- Event input -----------------------------------------------------------

export type EventInput = {
  symbol: string;
  accountId: string;
  side: Side;
  eventType: EventType;
  price: number;
  size: number;
  createdAt?: Date;
};

const ACCOUNT_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const MAX_SIZE = 1_000_000_000; // stays inside Postgres INT
const MAX_FUTURE_MS = 60_000;

// Validates one event payload against lib/eventTypes.ts.
export function parseEventInput(
  raw: unknown,
): { ok: true; value: EventInput } | { ok: false; errors: string[] } {
  if (!isPlainObject(raw)) return { ok: false, errors: ["event must be a JSON object"] };
  const errors: string[] = [];

  const symbol = normalizeSymbol(raw.symbol);
  if (!symbol) errors.push("symbol must be 1-16 chars of A-Z, 0-9, '.', '_' or '-'");

  const accountId = typeof raw.accountId === "string" ? raw.accountId.trim() : "";
  if (!ACCOUNT_RE.test(accountId)) {
    errors.push("accountId must be 1-64 chars of letters, digits, '.', '_', ':' or '-'");
  }

  const sideRaw = typeof raw.side === "string" ? raw.side.trim().toUpperCase() : "";
  const side = SIDES.find((s) => s === sideRaw);
  if (!side) errors.push(`side must be one of ${SIDES.join(", ")}`);

  const typeRaw = typeof raw.eventType === "string" ? raw.eventType.trim().toLowerCase() : "";
  const eventType = EVENT_TYPES.find((t) => t === typeRaw);
  if (!eventType) errors.push(`eventType must be one of ${EVENT_TYPES.join(", ")}`);

  const price = raw.price;
  if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
    errors.push("price must be a positive number");
  }

  const size = raw.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > MAX_SIZE) {
    errors.push(`size must be an integer between 1 and ${MAX_SIZE}`);
  }

  let createdAt: Date | undefined;
  if (raw.createdAt !== undefined && raw.createdAt !== null) {
    const d =
      typeof raw.createdAt === "string" || typeof raw.createdAt === "number"
        ? new Date(raw.createdAt)
        : null;
    if (!d || Number.isNaN(d.getTime())) {
      errors.push("createdAt must be an ISO date string or epoch milliseconds");
    } else if (d.getTime() > Date.now() + MAX_FUTURE_MS) {
      errors.push("createdAt cannot be more than 60s in the future");
    } else {
      createdAt = d;
    }
  }

  if (errors.length > 0 || !symbol || !side || !eventType) return { ok: false, errors };
  return {
    ok: true,
    value: {
      symbol,
      accountId,
      side,
      eventType,
      price: price as number,
      size: size as number,
      ...(createdAt ? { createdAt } : {}),
    },
  };
}
