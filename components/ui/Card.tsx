import type { HTMLAttributes, ReactNode } from "react";

// Cards follow the landing page: 2px radius, no shadow, a hairline rule.
// Light cards use the parchment surface tint. tone="terminal" is the dark
// ink panel the landing page embeds (market data only): same radius, a
// numbered 28px header, and the ink tokens via data-surface="terminal".

export type CardTone = "light" | "terminal";

export function cardClass(tone: CardTone = "light") {
  return tone === "terminal"
    ? "overflow-hidden rounded-[2px] border border-seam bg-panel text-text"
    : "rounded-[2px] border border-seam bg-panel text-text";
}

export function Card({
  tone = "light",
  className = "",
  children,
  ...rest
}: { tone?: CardTone; className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-surface={tone === "terminal" ? "terminal" : undefined} className={`${cardClass(tone)} ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function Panel({
  n,
  title,
  meta,
  actions,
  children,
  className = "",
  bodyClassName = "",
  id,
  tone = "light",
}: {
  n?: number;
  title: string;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
  tone?: CardTone;
}) {
  const headingId = id ? `${id}-title` : undefined;
  const terminal = tone === "terminal";
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-surface={terminal ? "terminal" : undefined}
      className={`flex min-w-0 scroll-mt-24 flex-col ${cardClass(tone)} ${className}`}
    >
      <header className={`flex shrink-0 items-center gap-2 border-b border-seam ${terminal ? "h-7 px-2" : "min-h-11 px-4 py-2"}`}>
        {n !== undefined && (
          <span className={`num text-dim ${terminal ? "text-[11px]" : "text-xs"}`} aria-hidden="true">
            {String(n).padStart(2, "0")}
          </span>
        )}
        <h2 id={headingId} className={`truncate font-semibold text-text ${terminal ? "text-[13px] leading-4" : "text-sm leading-5"}`}>
          {title}
        </h2>
        {meta && <span className={`truncate text-dim ${terminal ? "text-[11px]" : "text-xs"}`}>{meta}</span>}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-1">{actions}</div>}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
