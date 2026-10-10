import type { ReactNode, TableHTMLAttributes } from "react";

// Data tables: bottom rules only, no zebra, a hover tint on rows, numbers in
// mono via `num`. The same classes work on light cards and terminal panels.

export const tableClass = "w-full text-[12px]";
export const theadRowClass = "border-b border-seam text-[11px] text-dim";
export const thClass = "px-2 py-1.5 font-medium";
export const rowClass = "border-b border-seam/60 hover:bg-panelhi";

export function Table({
  className = "",
  caption,
  children,
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & { caption?: ReactNode }) {
  return (
    <table className={`${tableClass} ${className}`} {...rest}>
      {caption && <caption className="sr-only">{caption}</caption>}
      {children}
    </table>
  );
}
