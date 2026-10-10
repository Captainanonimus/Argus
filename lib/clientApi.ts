// Browser-side helpers for the JSON API: shared response types (dates arrive
// as ISO strings) and a fetch wrapper that turns every failure into a short,
// readable message.

import type { AlertStatus, AlertType, EventType, Side, Verdict } from "./eventTypes";

export type ApiEvent = {
  id: string;
  symbol: string;
  accountId: string;
  side: Side;
  price: number;
  size: number;
  eventType: EventType;
  createdAt: string;
};

export type ApiAlert = {
  id: string;
  orderEventId: string;
  alertType: AlertType;
  verdict: Verdict;
  metricValue: number;
  reason: string;
  createdAt: string;
  updatedAt: string;
  status: AlertStatus;
  note: string;
};

export type ApiAlertWithEvent = ApiAlert & { orderEvent: ApiEvent };

export type AlertsResponse = { alerts: ApiAlertWithEvent[]; nextCursor: string | null };

export type AlertCaseResponse = {
  alert: ApiAlert;
  event: ApiEvent;
  timeline: (ApiEvent & {
    alerts: { id: string; alertType: AlertType; verdict: Verdict }[];
  })[];
  window: { beforeMs: number; afterMs: number };
};

export type SymbolsResponse = {
  symbols: { symbol: string; lastPrice: number | null; lastEventAt: string | null; eventCount: number }[];
};

export type BookLevel = { price: number; size: number; orders: number };

export type StatsResponse = {
  symbol: string | null;
  totals: { events: number; eventsByType: Record<string, number>; alerts: number };
  flags: number;
  reviews: number;
  openAlerts: number;
  orderBook: { asOf: string | null; bids: BookLevel[]; asks: BookLevel[] } | null;
};

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ChartResponse = {
  symbol: string;
  seconds: number;
  priceSource: "fills" | "quotes" | null;
  candles: Candle[];
  markers: { time: number; verdict: Verdict; alertType: AlertType; alertId: string }[];
};

export type FeedResponse = {
  events: (ApiEvent & {
    alerts: {
      id: string;
      alertType: AlertType;
      verdict: Verdict;
      status: AlertStatus;
      metricValue: number;
      reason: string;
      createdAt: string;
    }[];
  })[];
};

export type SettingsStatus = {
  openrouter: boolean;
  tinyfish: boolean;
  db: boolean;
  sources: { openrouter: "cookie" | "env" | null; tinyfish: "cookie" | "env" | null };
};

export type IngestResponse = {
  event: ApiEvent;
  verdict: Verdict;
  reason: string;
  alertTypes: AlertType[];
};

export class ApiError extends Error {
  status: number;
  details: unknown;
  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// Fetches JSON with no caching. Non-2xx responses throw ApiError carrying the
// server's `error` message; network failures throw ApiError with status 0.
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError("Network error: the server could not be reached.", 0);
  }

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON body; handled below.
  }

  if (!res.ok) {
    const obj = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const message =
      typeof obj.error === "string" ? obj.error : `Request failed with status ${res.status}.`;
    throw new ApiError(message, res.status, obj.details);
  }
  if (body === null) throw new ApiError("The server sent an unreadable response.", res.status);
  return body as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
