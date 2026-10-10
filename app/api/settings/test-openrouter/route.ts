import { NextResponse } from "next/server";
import { getOpenRouterKey } from "@/lib/keys";

export const dynamic = "force-dynamic";

const KEY_INFO_URLS = ["https://openrouter.ai/api/v1/key", "https://openrouter.ai/api/v1/auth/key"];
const TIMEOUT_MS = 10_000;

// Checks the saved OpenRouter key against the key-info endpoint, which
// costs no credits. Always 200 with { ok, ... }; the key is never returned.
export async function GET() {
  const key = await getOpenRouterKey();
  if (!key) return NextResponse.json({ ok: false, error: "no_key", message: "No OpenRouter key is saved." });

  for (const url of KEY_INFO_URLS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.status === 404) continue;
      if (res.status === 401 || res.status === 403) {
        return NextResponse.json({ ok: false, error: "unauthorized", message: "OpenRouter rejected the key." });
      }
      if (!res.ok) {
        return NextResponse.json({ ok: false, error: `http_${res.status}`, message: "OpenRouter could not check the key right now." });
      }
      let freeTier: boolean | null = null;
      try {
        const data = (await res.json()) as { data?: { is_free_tier?: unknown } };
        if (typeof data.data?.is_free_tier === "boolean") freeTier = data.data.is_free_tier;
      } catch {
        // Accepted key; details unreadable.
      }
      return NextResponse.json({ ok: true, freeTier });
    } catch {
      const kind = controller.signal.aborted ? "timeout" : "network";
      console.warn(`[settings] openrouter test ${kind}`);
      return NextResponse.json({ ok: false, error: kind, message: "OpenRouter could not be reached." });
    } finally {
      clearTimeout(timer);
    }
  }
  return NextResponse.json({ ok: false, error: "http_404", message: "OpenRouter key check is unavailable." });
}
