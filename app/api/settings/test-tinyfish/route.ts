import { NextResponse } from "next/server";
import { search } from "@/lib/tinyfish";

export const dynamic = "force-dynamic";

// Runs one tiny search to check the saved TinyFish key. Always 200 with
// { ok, ... } so the settings page can show the outcome inline.
export async function GET() {
  const r = await search("market surveillance spoofing", 1);
  if (r.ok) return NextResponse.json({ ok: true, results: r.value.length });
  // "empty" still means the key was accepted.
  if (r.error.kind === "empty") return NextResponse.json({ ok: true, results: 0 });
  return NextResponse.json({ ok: false, error: r.error.kind, message: r.error.message });
}
