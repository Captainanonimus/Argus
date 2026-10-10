import type { AlertStatus, AlertType, Verdict } from "./eventTypes";

// Display helpers shared by the app pages. Numbers are formatted for mono,
// tabular columns; nothing here touches the network.

export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  quote_stuffing: "Quote stuffing",
  spoofing: "Spoofing",
  book_imbalance: "Book imbalance",
};

export const STATUS_LABEL: Record<AlertStatus, string> = {
  open: "Open",
  investigating: "Investigating",
  escalated: "Escalated",
  dismissed: "Dismissed",
};

export const VERDICT_LABEL: Record<Verdict, string> = {
  CLEAR: "Clear",
  REVIEW: "Review",
  FLAG: "Flag",
};

export function alertTypeLabel(t: string): string {
  return ALERT_TYPE_LABEL[t as AlertType] ?? t;
}

export function statusLabel(s: string): string {
  return STATUS_LABEL[s as AlertStatus] ?? s;
}

export function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

export function fmtInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "-";
  return Math.round(n).toLocaleString("en-US");
}

export function fmtSigned(n: number, digits = 2): string {
  const s = Math.abs(n).toFixed(digits);
  return n > 0 ? `+${s}` : n < 0 ? `-${s}` : s;
}

export function fmtMetric(type: string, value: number): string {
  if (type === "quote_stuffing") return `${value.toFixed(1)}:1`;
  if (type === "spoofing") return fmtInt(value);
  if (type === "book_imbalance") return `z ${value.toFixed(2)}`;
  return String(value);
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}

// 14:32:05.118 in local time.
export function fmtTimeMs(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function fmtTime(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function fmtDateTime(iso: string | number | Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${fmtTime(d)}`;
}

export function fmtRelative(iso: string | number | Date, now = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "-";
  const s = Math.round((now - t) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
