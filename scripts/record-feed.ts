// Records the Binance public market-data feed into the OrderEvent table so
// it can be replayed through the surveillance engine later. Run with:
//   npm run record -- [--symbols btcusdt,ethusdt] [--minutes 60] [--band-bps 10] [--depth-ms 100]
//
// Mapping onto the existing event schema (no schema change):
//   - aggTrade            -> "fill", side = aggressor side, account "BN-TAPE"
//   - depth diff increase -> "place" for the added quantity, account "BN-BOOK"
//   - depth diff decrease -> "cancel" for the quantity not explained by
//                            trades at that level since the last diff
// Only levels within --band-bps of the mid are emitted, which keeps volume
// close to the top of book. Quantities are converted to integer lots (see
// LOTS); any non-zero change is at least one lot so event counts, which drive
// the order-to-trade ratio, are preserved. Events are written with
// createdAt = Binance event time and are NOT evaluated by the engine here;
// use `npm run replay` or `npm run backtest` for that.

import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

type NewEvent = Prisma.OrderEventCreateManyInput;

const STREAM_BASE = "wss://stream.binance.com:9443/stream?streams=";
const REST_DEPTH = "https://api.binance.com/api/v3/depth";
const BATCH_SIZE = 200;
const FLUSH_INTERVAL_MS = 2_000;
const MAX_BUFFER = 50_000;
const STALE_MS = 30_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 60_000;
const STABLE_MS = 30_000;
const STATS_INTERVAL_MS = 30_000;

// Size of one integer lot per symbol, in base-asset units. The engine's
// large-order line is 500 lots (0.5 BTC / 5 ETH with these defaults).
// Override with RECORD_LOTS="BTCUSDT:0.001,ETHUSDT:0.01".
const DEFAULT_LOTS: Record<string, number> = { BTCUSDT: 0.001, ETHUSDT: 0.01 };
const FALLBACK_LOT = 0.001;

const BOOK_ACCOUNT = "BN-BOOK";
const TAPE_ACCOUNT = "BN-TAPE";

// --- CLI -------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const SYMBOLS = (arg("symbols") ?? process.env.RECORD_SYMBOLS ?? "btcusdt,ethusdt")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
const MINUTES = Number(arg("minutes") ?? 0); // 0 = run until Ctrl+C
const BAND_BPS = Number(arg("band-bps") ?? 10);
const DEPTH_MS = arg("depth-ms") === "1000" ? 1000 : 100;

function parseLots(): Record<string, number> {
  const lots = { ...DEFAULT_LOTS };
  for (const pair of (process.env.RECORD_LOTS ?? "").split(",")) {
    const [sym, size] = pair.split(":");
    const n = Number(size);
    if (sym && Number.isFinite(n) && n > 0) lots[sym.trim().toUpperCase()] = n;
  }
  return lots;
}
const LOTS = parseLots();

function toLots(symbol: string, qty: number): number {
  return Math.max(1, Math.round(qty / (LOTS[symbol] ?? FALLBACK_LOT)));
}

// --- Event buffer and batched writes --------------------------------------

const buffer: NewEvent[] = [];
let written = 0;
let dropped = 0;
let writing: Promise<void> = Promise.resolve();

function push(e: NewEvent) {
  buffer.push(e);
  if (buffer.length > MAX_BUFFER) {
    const over = buffer.length - MAX_BUFFER;
    buffer.splice(0, over);
    dropped += over;
  }
  if (buffer.length >= BATCH_SIZE) void flush();
}

// Writes full batches of 200 (and the remainder when `all` is set). Writes
// are serialized; a failed batch goes back to the front of the buffer.
function flush(all = false): Promise<void> {
  writing = writing.then(async () => {
    while (buffer.length >= BATCH_SIZE || (all && buffer.length > 0)) {
      const batch = buffer.splice(0, BATCH_SIZE);
      try {
        await prisma.orderEvent.createMany({ data: batch });
        written += batch.length;
      } catch (err) {
        buffer.unshift(...batch);
        console.error(`[record] write failed, will retry: ${err instanceof Error ? err.message.split("\n")[0] : err}`);
        return;
      }
    }
  });
  return writing;
}

// --- Order book state per symbol ------------------------------------------

type Level = [string, string];
type DepthDiff = { e: "depthUpdate"; E: number; s: string; U: number; u: number; b: Level[]; a: Level[] };
type AggTrade = { e: "aggTrade"; E: number; s: string; p: string; q: string; T: number; m: boolean };

type Book = {
  symbol: string; // upper case
  bids: Map<string, number>;
  asks: Map<string, number>;
  lastUpdateId: number;
  synced: boolean;
  syncing: boolean;
  pending: DepthDiff[];
  // Quantity traded at each level since the last applied diff, keyed by
  // "b:price" / "a:price" for the resting side that was hit.
  consumed: Map<string, number>;
};

const books = new Map<string, Book>();

function resetBooks() {
  books.clear();
  for (const s of SYMBOLS) {
    const symbol = s.toUpperCase();
    books.set(symbol, {
      symbol,
      bids: new Map(),
      asks: new Map(),
      lastUpdateId: 0,
      synced: false,
      syncing: false,
      pending: [],
      consumed: new Map(),
    });
  }
}

function bestPrice(side: Map<string, number>, pick: (a: number, b: number) => number): number | null {
  let best: number | null = null;
  for (const p of Array.from(side.keys())) {
    const n = Number(p);
    best = best === null ? n : pick(best, n);
  }
  return best;
}

async function syncBook(book: Book) {
  if (book.syncing) return;
  book.syncing = true;
  book.synced = false;
  try {
    const res = await fetch(`${REST_DEPTH}?symbol=${book.symbol}&limit=1000`, { cache: "no-store" });
    if (!res.ok) throw new Error(`snapshot HTTP ${res.status}`);
    const snap = (await res.json()) as { lastUpdateId: number; bids: Level[]; asks: Level[] };
    book.bids = new Map(snap.bids.map(([p, q]) => [p, Number(q)]));
    book.asks = new Map(snap.asks.map(([p, q]) => [p, Number(q)]));
    book.lastUpdateId = snap.lastUpdateId;
    book.consumed.clear();
    book.synced = true;
    // Apply buffered diffs newer than the snapshot.
    const queued = book.pending.splice(0);
    for (const d of queued) applyDiff(book, d);
    console.log(`[record] ${book.symbol} book synced at update ${snap.lastUpdateId}`);
  } catch (err) {
    console.error(`[record] ${book.symbol} snapshot failed: ${err instanceof Error ? err.message : err}`);
    setTimeout(() => void syncBook(book), 2_000);
  } finally {
    book.syncing = false;
  }
}

function applyDiff(book: Book, d: DepthDiff) {
  if (!book.synced) {
    book.pending.push(d);
    if (!book.syncing) void syncBook(book);
    return;
  }
  if (d.u <= book.lastUpdateId) return; // already in the snapshot
  if (d.U > book.lastUpdateId + 1) {
    // Gap in the update sequence: the local book is no longer trustworthy.
    console.warn(`[record] ${book.symbol} sequence gap (${book.lastUpdateId} -> ${d.U}), resyncing`);
    book.synced = false;
    book.pending = [d];
    void syncBook(book);
    return;
  }

  const bestBid = bestPrice(book.bids, Math.max);
  const bestAsk = bestPrice(book.asks, Math.min);
  const mid = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const band = mid !== null ? (mid * BAND_BPS) / 10_000 : null;
  const createdAt = new Date(d.E);

  const side = (levels: Level[], map: Map<string, number>, key: "b" | "a", orderSide: "BUY" | "SELL") => {
    for (const [p, q] of levels) {
      const qty = Number(q);
      const prev = map.get(p) ?? 0;
      if (qty === 0) map.delete(p);
      else map.set(p, qty);

      const price = Number(p);
      if (band === null || mid === null || Math.abs(price - mid) > band) continue;
      const delta = qty - prev;
      if (delta > 0) {
        push({ symbol: book.symbol, accountId: BOOK_ACCOUNT, side: orderSide, price, size: toLots(book.symbol, delta), eventType: "place", createdAt });
      } else if (delta < 0) {
        const traded = book.consumed.get(`${key}:${p}`) ?? 0;
        const canceled = -delta - traded;
        if (canceled > 1e-12) {
          push({ symbol: book.symbol, accountId: BOOK_ACCOUNT, side: orderSide, price, size: toLots(book.symbol, canceled), eventType: "cancel", createdAt });
        }
      }
    }
  };
  side(d.b, book.bids, "b", "BUY");
  side(d.a, book.asks, "a", "SELL");
  book.consumed.clear();
  book.lastUpdateId = d.u;
}

function applyTrade(book: Book, t: AggTrade) {
  const qty = Number(t.q);
  // m = buyer is maker: a sell aggressor hit the bid.
  const aggressor = t.m ? "SELL" : "BUY";
  const key = `${t.m ? "b" : "a"}:${t.p}`;
  book.consumed.set(key, (book.consumed.get(key) ?? 0) + qty);
  push({
    symbol: book.symbol,
    accountId: TAPE_ACCOUNT,
    side: aggressor,
    price: Number(t.p),
    size: toLots(book.symbol, qty),
    eventType: "fill",
    createdAt: new Date(t.T),
  });
}

// --- WebSocket with reconnect ---------------------------------------------

let ws: WebSocket | null = null;
let stopping = false;
let attempt = 0;
let lastMessageAt = 0;
let received = 0;

function streamUrl() {
  const streams = SYMBOLS.flatMap((s) => [`${s}@depth@${DEPTH_MS}ms`, `${s}@aggTrade`]);
  return STREAM_BASE + streams.join("/");
}

function connect() {
  if (stopping) return;
  resetBooks();
  const socket = new WebSocket(streamUrl());
  ws = socket;
  let openedAt = 0;

  socket.onopen = () => {
    openedAt = Date.now();
    lastMessageAt = Date.now();
    console.log(`[record] connected (${SYMBOLS.join(", ")}; depth ${DEPTH_MS}ms; band ${BAND_BPS}bps)`);
  };

  socket.onmessage = (msg) => {
    lastMessageAt = Date.now();
    received++;
    if (openedAt && attempt > 0 && Date.now() - openedAt > STABLE_MS) attempt = 0;
    let payload: { stream?: string; data?: DepthDiff | AggTrade };
    try {
      payload = JSON.parse(String(msg.data));
    } catch {
      return;
    }
    const data = payload.data;
    if (!data) return;
    const book = books.get(data.s);
    if (!book) return;
    if (data.e === "depthUpdate") applyDiff(book, data);
    else if (data.e === "aggTrade") applyTrade(book, data);
  };

  socket.onerror = () => {
    // onclose follows and handles the reconnect.
  };

  socket.onclose = (ev) => {
    if (ws !== socket) return;
    ws = null;
    if (stopping) return;
    const delay = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt) * (0.5 + Math.random() / 2);
    attempt++;
    console.warn(`[record] disconnected (code ${ev.code}); reconnecting in ${(delay / 1000).toFixed(1)}s`);
    setTimeout(connect, delay);
  };
}

// Binance can leave a socket open but silent; treat that as a disconnect.
const watchdog = setInterval(() => {
  if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMessageAt > STALE_MS) {
    console.warn("[record] no messages for 30s, forcing reconnect");
    ws.close();
  }
}, 5_000);

const flusher = setInterval(() => void flush(true), FLUSH_INTERVAL_MS);

const stats = setInterval(() => {
  console.log(`[record] messages=${received} written=${written} buffered=${buffer.length}${dropped ? ` dropped=${dropped}` : ""}`);
}, STATS_INTERVAL_MS);

async function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(watchdog);
  clearInterval(flusher);
  clearInterval(stats);
  ws?.close();
  await flush(true);
  console.log(`[record] stopped. written=${written}${buffer.length ? ` unsaved=${buffer.length}` : ""}${dropped ? ` dropped=${dropped}` : ""}`);
  await prisma.$disconnect();
  process.exit(code);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));
if (MINUTES > 0) setTimeout(() => void shutdown(0), MINUTES * 60_000);

if (SYMBOLS.length === 0) {
  console.error("[record] no symbols given");
  process.exit(1);
}
connect();
