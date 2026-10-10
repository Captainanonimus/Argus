import { NextResponse } from "next/server";
import { isPlainObject, jsonError, logRouteError, readJsonBody } from "./api";

// Handlers for POST/DELETE /api/settings/<provider>: save or clear an API key
// in an httpOnly cookie. The key is never echoed back or logged.

const MAX_AGE_S = 30 * 24 * 60 * 60;
const MIN_LEN = 8;
const MAX_LEN = 512;
// Printable ASCII with no spaces - anything else is not a real API key.
const KEY_RE = /^[\x21-\x7e]+$/;

function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export function keyCookieHandlers(cookieName: string, label: string) {
  async function POST(req: Request) {
    try {
      // JSON-only, so a plain cross-site form post cannot overwrite the key.
      if (!req.headers.get("content-type")?.toLowerCase().includes("application/json")) {
        return jsonError(415, "Content-Type must be application/json.");
      }
      const parsed = await readJsonBody(req);
      if (!parsed.ok) return parsed.res;
      const body = parsed.body;
      const key = isPlainObject(body) && typeof body.key === "string" ? body.key.trim() : "";
      if (!key) return jsonError(400, `${label} key is required.`);
      if (key.length < MIN_LEN || key.length > MAX_LEN || !KEY_RE.test(key)) {
        return jsonError(
          400,
          `${label} key must be ${MIN_LEN}-${MAX_LEN} printable characters with no spaces.`,
        );
      }

      const res = NextResponse.json({ ok: true, saved: true, source: "cookie" });
      res.cookies.set(cookieName, key, cookieOptions(MAX_AGE_S));
      return res;
    } catch (err) {
      logRouteError(`POST /api/settings (${label})`, err);
      return jsonError(500, "Internal error - the key was not saved.");
    }
  }

  async function DELETE() {
    try {
      const res = NextResponse.json({ ok: true, cleared: true });
      res.cookies.set(cookieName, "", cookieOptions(0));
      return res;
    } catch (err) {
      logRouteError(`DELETE /api/settings (${label})`, err);
      return jsonError(500, "Internal error - the key was not cleared.");
    }
  }

  return { POST, DELETE };
}
