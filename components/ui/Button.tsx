import type { ButtonHTMLAttributes } from "react";

// Buttons and button-styled links. Primary is the landing page's charcoal
// button (gradient underline on hover/focus, press scale); secondary is a
// bordered control; ghost reads like the landing page's text links.
// No "use client": buttonClass() is safe to call from server components.

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded font-sans text-[13px] font-medium leading-4 disabled:cursor-not-allowed disabled:opacity-50";
// Primary animates transform itself (.btn-app-primary in globals.css).
const FADE = "transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]";
const VARIANT: Record<ButtonVariant, string> = {
  primary: "btn-app-primary",
  secondary: `${FADE} border border-edge bg-ink text-text hover:bg-panelhi`,
  ghost: `${FADE} text-text underline decoration-1 underline-offset-[3px] hover:bg-panelhi/60 hover:decoration-2`,
  // System action with consequences: plain text on a 1px ask border.
  danger: `${FADE} border border-ask text-text hover:bg-ask/10`,
};
const SIZE: Record<ButtonSize, string> = { sm: "h-8 px-2.5", md: "h-9 px-3.5", lg: "h-11 px-5 text-sm" };

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md") {
  return `${BASE} ${VARIANT[variant]} ${SIZE[size]}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}

// Square icon-only button; the label doubles as the tooltip.
export function IconButton({
  label,
  pressed,
  className = "",
  children,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label"> & { label: string; pressed?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-[2px] transition-colors duration-150 ${
        pressed ? "bg-panelhi text-text" : "text-dim hover:bg-panelhi hover:text-text"
      } ${className}`}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex">
        {children}
      </span>
    </button>
  );
}
