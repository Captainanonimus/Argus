import type { ReactNode } from "react";
import type { Side, Verdict } from "@/lib/eventTypes";
import { statusLabel } from "@/lib/format";

// Badges after the landing page's "Watching" (hairline) and "ALERT"
// (gradient fill, charcoal text) chips. The gradient is only ever a
// background, never a text colour, and every verdict carries its label.

const CHIP = "inline-flex h-5 shrink-0 items-center justify-center rounded-[2px] px-1.5 font-mono text-[11px] leading-none";

export function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`${CHIP} border border-seam text-dim ${className}`}>{children}</span>;
}

// Fixed colours so a chip reads the same on parchment and on ink panels.
// Contrast: charcoal on the gradient's centre 4.7:1, #6B4400 on #F6E3BF
// 6.8:1, #2F5D3E on #E1ECE3 6.3:1.
export function VerdictBadge({ verdict, className = "" }: { verdict: Verdict | string; className?: string }) {
  if (verdict === "FLAG") {
    return (
      <span
        className={`${CHIP} min-w-[3.25rem] font-semibold tracking-[0.04em] text-[#1A1614] ${className}`}
        style={{ background: "var(--m-gradient)" }}
      >
        FLAG
      </span>
    );
  }
  if (verdict === "REVIEW") {
    return (
      <span className={`${CHIP} min-w-[3.25rem] border border-[#E2C48A] bg-[#F6E3BF] font-semibold text-[#6B4400] ${className}`}>
        REVIEW
      </span>
    );
  }
  if (verdict === "CLEAR") {
    return (
      <span className={`${CHIP} min-w-[3.25rem] border border-[#C3D8C8] bg-[#E1ECE3] text-[#2F5D3E] ${className}`}>CLEAR</span>
    );
  }
  return <Badge className={className}>{verdict}</Badge>;
}

const STATUS_GLYPH: Record<string, string> = {
  open: "○",
  investigating: "◐",
  escalated: "▲",
  dismissed: "×",
};

export function StatusTag({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-text">
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
