"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowClockwise, WarningOctagon } from "@phosphor-icons/react";
import { buttonClass } from "./Button";

export function LoadingState({ label = "Loading", rows = 5 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="space-y-2 p-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-4 animate-pulse rounded-[2px] bg-panelhi motion-reduce:animate-none"
          style={{ width: `${88 - ((i * 17) % 40)}%` }}
        />
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
      <p className="text-[15px] font-semibold leading-5 text-text">{title}</p>
      {body && <p className="max-w-[60ch] text-[13px] leading-[19px] text-dim">{body}</p>}
      {(actionHref || secondary) && (
        <div className="mt-2 flex flex-wrap items-center gap-4">
          {actionHref && (
            <Link href={actionHref} className={buttonClass("primary", "sm")}>
              {actionLabel}
            </Link>
          )}
          {secondary}
        </div>
      )}
    </div>
  );
}

// System errors: plain text with an icon on a 1px ask border (never an
// ask-coloured fill), plus a retry when one makes sense.
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
      className={`flex items-start gap-2 rounded-[2px] border border-ask bg-ink text-text ${compact ? "my-2 p-2.5" : "my-3 p-3.5"}`}
    >
      <WarningOctagon size={16} aria-hidden="true" className="mt-px shrink-0 text-ask" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-[19px]">{message}</p>
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
