import type { ReactNode } from "react";

// Hairline status chip, after the landing page's "Watching" badge. State is
// carried by the glyph and the text, never by colour alone.
export function StatChip({
  label,
  value,
  ok,
  className = "",
}: {
  label: string;
  value?: ReactNode;
  ok: boolean | null;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-[2px] border px-2 text-xs text-text ${
        ok === false ? "border-ask" : "border-seam"
      } ${className}`}
    >
      <span aria-hidden="true" className={ok === false ? "text-ask" : ok ? "text-bid" : "text-dim"}>
        {ok === null ? "…" : ok ? "●" : "○"}
      </span>
      <span className="text-dim">{label}</span>
      {value !== undefined && <span>{value}</span>}
    </span>
  );
}

// Key figure tile: small muted label, mono value, optional mono footnote.
export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[2px] border border-seam bg-panel px-3 py-2.5">
      <p className="truncate text-xs text-dim">{label}</p>
      <p className="num mt-0.5 truncate text-[20px] font-medium leading-6 text-text">{value}</p>
      {sub && <p className="num truncate text-[11px] text-dim">{sub}</p>}
    </div>
  );
}
