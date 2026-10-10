import type { ReactNode } from "react";

// Page title in Fraunces, as on the landing page, one step down its h2
// scale. An optional lede sits below in the muted sans.
export function PageHeader({
  title,
  eyebrow,
  description,
  children,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 pb-6">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-sm text-dim">{eyebrow}</p>}
        <h1 className="font-display text-[clamp(1.75rem,1.4rem+1.4vw,2.5rem)] font-medium leading-[1.12] tracking-[-0.02em] text-text [text-wrap:balance]">
          {title}
        </h1>
        {description && <p className="mt-2 max-w-[68ch] text-[15px] leading-[1.55] text-dim [text-wrap:pretty]">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
