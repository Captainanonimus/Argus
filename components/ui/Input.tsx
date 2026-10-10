import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";

// Form controls: parchment field, 3:1 control border, 4px radius like the
// landing page's buttons. Labels are small sans in the muted ink.

export const inputClass =
  "h-9 w-full min-w-0 rounded border border-edge bg-ink px-2.5 text-[13px] text-text placeholder:text-dim/80 hover:border-text/60 disabled:opacity-60";

export const textareaClass =
  "w-full resize-y rounded border border-edge bg-ink p-2.5 text-[13px] leading-[19px] text-text placeholder:text-dim/80 hover:border-text/60";

export function Label({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-dim">
      {children}
    </label>
  );
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`} {...rest} />;
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${textareaClass} ${className}`} {...rest} />;
}
