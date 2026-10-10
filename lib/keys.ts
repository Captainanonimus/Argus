import { cookies } from "next/headers";

// Single source for third-party API keys: the httpOnly cookie saved from the
// settings routes wins, then the environment. Keys are only ever returned to
// server code - never logged and never sent back to the browser.

export const OPENROUTER_COOKIE = "openrouter_key";
export const TINYFISH_COOKIE = "tinyfish_key";

export type KeySource = "cookie" | "env";
type ResolvedKey = { key: string; source: KeySource };

async function readCookie(name: string): Promise<string | null> {
  try {
    // Works whether cookies() is sync (Next 14) or async (Next 15+).
    const store = await Promise.resolve(cookies());
    return store.get(name)?.value?.trim() || null;
  } catch {
    // Outside a request scope - fall through to the environment.
    return null;
  }
}

async function resolveKey(cookieName: string, envName: string): Promise<ResolvedKey | null> {
  const fromCookie = await readCookie(cookieName);
  if (fromCookie) return { key: fromCookie, source: "cookie" };
  const fromEnv = process.env[envName]?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  return null;
}

const resolveOpenRouter = () => resolveKey(OPENROUTER_COOKIE, "OPENROUTER_API_KEY");
const resolveTinyFish = () => resolveKey(TINYFISH_COOKIE, "TINYFISH_API_KEY");

export async function getOpenRouterKey(): Promise<string | null> {
  return (await resolveOpenRouter())?.key ?? null;
}

export async function getTinyFishKey(): Promise<string | null> {
  return (await resolveTinyFish())?.key ?? null;
}

// Where each key would come from - booleans and source names only.
export async function getKeySources(): Promise<{
  openrouter: KeySource | null;
  tinyfish: KeySource | null;
}> {
  const [openrouter, tinyfish] = await Promise.all([resolveOpenRouter(), resolveTinyFish()]);
  return { openrouter: openrouter?.source ?? null, tinyfish: tinyfish?.source ?? null };
}
