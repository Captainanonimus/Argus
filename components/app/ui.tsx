"use client";

import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ArrowClockwise, WarningOctagon } from "@phosphor-icons/react";
import type { Side, Verdict } from "@/lib/eventTypes";
import { statusLabel } from "@/lib/format";

// Terminal-surface building blocks. Square 2px radius, 1px seams, no shadows.
// bid/ask colours only ever mean side or direction; cyan only means an alert.

export function Panel({
  n,
  title,
  meta,
  actions,
  children,
  className = "",
  bodyClassName = "",
  id,
}: {
  n?: number;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={`flex min-w-0 flex-col bg-panel ${className}`}
    >
      <header className="flex h-7 shrink-0 items-center gap-2 border-b border-seam px-2">
        {n !== undefined && (
          <span className="num text-[11px] text-dim" aria-hidden="true">
            {String(n).padStart(2, "0")}
          </span>
        )}
        <h2 id={headingId} className="truncate font-condensed text-[13px] font-semibold leading-4 text-text">
          {title}
        </h2>
        {meta && <span className="truncate font-condensed text-[11px] text-dim">{meta}</span>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-1.5 rounded-[2px] font-condensed text-[13px] font-semibold leading-4 transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50";
const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-text text-ink hover:bg-white",
  secondary: "border border-seam bg-panelhi text-text hover:border-dim",
  ghost: "text-dim hover:bg-panelhi hover:text-text",
  // System action with consequences: fg text on a 1px ask border.
  danger: "border border-ask/70 text-text hover:bg-ask/10",
};
const BUTTON_SIZE = { sm: "h-7 px-2", md: "h-8 px-3", lg: "h-10 px-4" } as const;

export function buttonClass(variant: ButtonVariant = "secondary", size: keyof typeof BUTTON_SIZE = "md") {
  return `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: keyof typeof BUTTON_SIZE }) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}

export function VerdictBadge({ verdict, className = "" }: { verdict: Verdict | string; className?: string }) {
  if (verdict === "FLAG") {
    return (
      <span className={`inline-flex h-5 items-center rounded-[2px] bg-alert px-1.5 font-mono text-[11px] font-semibold text-ink ${className}`}>
        FLAG
      </span>
    );
  }
  if (verdict === "REVIEW") {
    return (
      <span className={`inline-flex h-5 items-center rounded-[2px] border border-alert px-1.5 font-mono text-[11px] font-semibold text-alert ${className}`}>
        REVIEW
      </span>
    );
  }
  return (
    <span className={`inline-flex h-5 items-center rounded-[2px] border border-seam px-1.5 font-mono text-[11px] text-dim ${className}`}>
      {verdict}
    </span>
  );
}

const STATUS_GLYPH: Record<string, string> = {
  open: "○",
  investigating: "◐",
  escalated: "▲",
  dismissed: "×",
};

export function StatusTag({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1 font-condensed text-[12px] text-text">
      <span aria-hidden="true" className="text-dim">
        {STATUS_GLYPH[status] ?? "·"}
      </span>
      {statusLabel(status)}
    </span>
  );
}

export function SideTag({ side }: { side: Side | string }) {
  const buy = side === "BUY";
  return (
    <span className={`num text-[12px] ${buy ? "text-bid" : "text-ask"}`}>
      {buy ? "BUY" : "SELL"}
      <span aria-hidden="true"> {buy ? "▲" : "▼"}</span>
    </span>
  );
}

export function LoadingState({ label = "Loading", rows = 5 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-1.5 p-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-4 animate-pulse rounded-[2px] bg-panelhi motion-reduce:animate-none" style={{ width: `${88 - ((i * 17) % 40)}%` }} />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  body,
  actionHref = "/simulator",
  actionLabel = "Open the simulator",
  secondary,
}: {
  title: string;
  body?: ReactNode;
  actionHref?: string | null;
  actionLabel?: string;
  secondary?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 p-4">
      <p className="font-condensed text-[14px] font-semibold text-text">{title}</p>
      {body && <p className="max-w-[60ch] text-[13px] leading-[18px] text-dim">{body}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        {actionHref && (
          <Link href={actionHref} className={buttonClass("primary", "sm")}>
            {actionLabel}
          </Link>
        )}
        {secondary}
      </div>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  compact = false,
}: {
  message: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-2 rounded-[2px] border border-ask/70 bg-panel text-text ${compact ? "m-2 p-2" : "m-3 p-3"}`}
    >
      <WarningOctagon size={16} aria-hidden="true" className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-[18px]">{message}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className={`${buttonClass("secondary", "sm")} mt-2`}>
            <ArrowClockwise size={14} aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block font-condensed text-[11px] font-medium tracking-[0.02em] text-dim">
      {children}
    </label>
  );
}

export const inputClass =
  "h-8 w-full min-w-0 rounded-[2px] border border-seam bg-ink px-2 text-[13px] text-text placeholder:text-dim/70 hover:border-dim";

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 bg-panel px-3 py-2">
      <p className="truncate font-condensed text-[11px] font-medium tracking-[0.02em] text-dim">{label}</p>
      <p className="num truncate text-[20px] font-medium leading-6 text-text">{value}</p>
      {sub && <p className="num truncate text-[11px] text-dim">{sub}</p>}
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-seam bg-ink px-3 py-3 sm:px-4">
      <h1 className="font-condensed text-[18px] font-semibold leading-6 text-text">{title}</h1>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
