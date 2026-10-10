import { keyCookieHandlers } from "@/lib/keyCookieRoute";
import { TINYFISH_COOKIE } from "@/lib/keys";

const handlers = keyCookieHandlers(TINYFISH_COOKIE, "TinyFish");

export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
