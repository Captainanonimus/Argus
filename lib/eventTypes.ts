export const EVENT_TYPES = ["place", "cancel", "fill"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const SIDES = ["BUY", "SELL"] as const;
export type Side = (typeof SIDES)[number];

export const VERDICTS = ["CLEAR", "REVIEW", "FLAG"] as const;
export type Verdict = (typeof VERDICTS)[number];

export const ALERT_TYPES = ["quote_stuffing", "spoofing", "book_imbalance"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];
