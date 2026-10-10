import { keyCookieHandlers } from "@/lib/keyCookieRoute";
import { OPENROUTER_COOKIE } from "@/lib/keys";

const handlers = keyCookieHandlers(OPENROUTER_COOKIE, "OpenRouter");

export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
