import { EVENT_TYPES, SIDES, type EventType, type Side } from "./eventTypes";

// CSV import for order events. Validation mirrors parseEventInput in
// lib/api.ts so rows that pass here are accepted by /api/events/batch.

export const CSV_COLUMNS = [
  { name: "symbol", required: true, desc: "Ticker, 1 to 16 characters of A-Z, 0-9, '.', '_' or '-'. Lowercase is uppercased." },
  { name: "accountId", required: true, desc: "Account that sent the order, 1 to 64 letters, digits, '.', '_', ':' or '-'." },
  { name: "side", required: true, desc: "BUY or SELL." },
  { name: "eventType", required: true, desc: "place, cancel or fill." },
  { name: "price", required: true, desc: "Positive number, for example 101.25." },
  { name: "size", required: true, desc: "Whole number of shares, 1 to 1,000,000,000." },
  { name: "createdAt", required: false, desc: "Optional. ISO 8601 time (2026-01-05T14:32:05.118Z) or epoch milliseconds. Leave blank to use the time of import. At most 60s in the future." },
] as const;

export type ImportEvent = {
  symbol: string;
  accountId: string;
  side: Side;
  eventType: EventType;
  price: number;
  size: number;
  createdAt?: string | number;
};

export type RowError = { line: number; errors: string[] };

export type ParseResult = {
  events: ImportEvent[];
  // Source line number of each accepted event, for mapping server results back.
  lines: number[];
  errors: RowError[];
  headerError: string | null;
};

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9._-]{0,15}$/;
const ACCOUNT_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const MAX_SIZE = 1_000_000_000;
const MAX_FUTURE_MS = 60_000;
export const MAX_ROWS = 20_000;

// RFC 4180 style: quoted fields, doubled quotes, CRLF or LF line ends.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  symbol: "symbol",
  ticker: "symbol",
  accountid: "accountId",
  account: "accountId",
  account_id: "accountId",
  side: "side",
  eventtype: "eventType",
  event_type: "eventType",
  type: "eventType",
  price: "price",
  size: "size",
  qty: "size",
  quantity: "size",
  createdat: "createdAt",
  created_at: "createdAt",
  timestamp: "createdAt",
  time: "createdAt",
};

export function validateCsv(text: string, now = Date.now()): ParseResult {
  const result: ParseResult = { events: [], lines: [], errors: [], headerError: null };
  const rows = parseCsv(text);
  // Line numbers are 1-based and count the header.
  const numbered = rows
    .map((cells, i) => ({ cells, line: i + 1 }))
    .filter(({ cells }) => cells.some((c) => c.trim() !== ""));
  if (numbered.length === 0) {
    result.headerError = "The file is empty. Add a header row and at least one event.";
    return result;
  }

  const header = numbered[0].cells.map((h) => HEADER_ALIASES[h.trim().toLowerCase()] ?? null);
  const missing = CSV_COLUMNS.filter((c) => c.required && !header.includes(c.name)).map((c) => c.name);
  if (missing.length > 0) {
    result.headerError = `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. The first row must be a header.`;
    return result;
  }
  const col = (name: string) => header.indexOf(name);
  const idx = {
    symbol: col("symbol"),
    accountId: col("accountId"),
    side: col("side"),
    eventType: col("eventType"),
    price: col("price"),
    size: col("size"),
    createdAt: col("createdAt"),
  };

  const body = numbered.slice(1);
  if (body.length === 0) {
    result.headerError = "The file has a header but no event rows.";
    return result;
  }
  if (body.length > MAX_ROWS) {
    result.headerError = `The file has ${body.length.toLocaleString("en-US")} rows. The limit is ${MAX_ROWS.toLocaleString("en-US")} per import.`;
    return result;
  }

  for (const { cells, line } of body) {
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");
    const errors: string[] = [];

    const symbol = get(idx.symbol).toUpperCase();
    if (!SYMBOL_RE.test(symbol)) errors.push("symbol must be 1-16 chars of A-Z, 0-9, '.', '_' or '-'");

    const accountId = get(idx.accountId);
    if (!ACCOUNT_RE.test(accountId)) errors.push("accountId must be 1-64 letters, digits, '.', '_', ':' or '-'");

    const sideRaw = get(idx.side).toUpperCase();
    const side = SIDES.find((s) => s === sideRaw);
    if (!side) errors.push("side must be BUY or SELL");

    const typeRaw = get(idx.eventType).toLowerCase();
    const eventType = EVENT_TYPES.find((t) => t === typeRaw);
    if (!eventType) errors.push("eventType must be place, cancel or fill");

    const priceRaw = get(idx.price);
    const price = Number(priceRaw);
    if (priceRaw === "" || !Number.isFinite(price) || price <= 0) errors.push("price must be a positive number");

    const sizeRaw = get(idx.size);
    const size = Number(sizeRaw);
    if (sizeRaw === "" || !Number.isInteger(size) || size <= 0 || size > MAX_SIZE) {
      errors.push("size must be a whole number from 1 to 1,000,000,000");
    }

    let createdAt: string | number | undefined;
    const tsRaw = get(idx.createdAt);
    if (tsRaw !== "") {
      const asNum = /^\d+$/.test(tsRaw) ? Number(tsRaw) : null;
      const d = new Date(asNum ?? tsRaw);
      if (Number.isNaN(d.getTime())) errors.push("createdAt must be an ISO date or epoch milliseconds");
      else if (d.getTime() > now + MAX_FUTURE_MS) errors.push("createdAt cannot be more than 60s in the future");
      else createdAt = asNum ?? d.toISOString();
    }

    if (errors.length > 0 || !side || !eventType) {
      result.errors.push({ line, errors });
      continue;
    }
    result.events.push({
      symbol,
      accountId,
      side,
      eventType,
      price,
      size,
      ...(createdAt !== undefined ? { createdAt } : {}),
    });
    result.lines.push(line);
  }
  return result;
}

// A short, valid sample: a few seconds of two-sided quoting and trades on
// SIMCSV. No timestamps, so the events are stamped at import time.
export const SAMPLE_CSV = [
  "symbol,accountId,side,eventType,price,size,createdAt",
  "SIMCSV,MM-01,BUY,place,100.24,300,",
  "SIMCSV,MM-01,SELL,place,100.26,300,",
  "SIMCSV,ACC-1042,BUY,fill,100.26,100,",
  "SIMCSV,MM-02,BUY,place,100.25,200,",
  "SIMCSV,MM-02,SELL,place,100.27,200,",
  "SIMCSV,ACC-2288,SELL,fill,100.25,200,",
  "SIMCSV,ACC-3105,BUY,fill,100.27,100,",
  "SIMCSV,MM-01,BUY,cancel,100.24,300,",
  "SIMCSV,MM-01,SELL,cancel,100.26,300,",
  "SIMCSV,MM-01,BUY,place,100.26,400,",
  "SIMCSV,MM-01,SELL,place,100.28,400,",
  "SIMCSV,ACC-4471,BUY,fill,100.28,300,",
  "",
].join("\r\n");
