"use client";

import { useId, useState, type FormEvent } from "react";
import { ArrowSquareOut } from "@phosphor-icons/react";
import { errorMessage, fetchJson } from "@/lib/clientApi";
import { announceSettingsChanged } from "@/components/app/hooks";
import { Button, inputClass } from "@/components/app/ui";

export type KeyProvider = "openrouter" | "tinyfish";

export const PROVIDERS: Record<
  KeyProvider,
  { name: string; purpose: string; getKeyUrl: string; getKeyLabel: string; signUpUrl: string }
> = {
  openrouter: {
    name: "OpenRouter",
    purpose: "Runs the free open models behind the gray-zone check and the assistant.",
    getKeyUrl: "https://openrouter.ai/keys",
    getKeyLabel: "Get an OpenRouter key",
    signUpUrl: "https://openrouter.ai/",
  },
  tinyfish: {
    name: "TinyFish",
    purpose: "Lets the assistant search the web and read result pages.",
    getKeyUrl: "https://agent.tinyfish.ai/sign-up",
    getKeyLabel: "Get a TinyFish key",
    signUpUrl: "https://agent.tinyfish.ai/sign-up",
  },
};

// Password input + Save, posting to /api/settings/<provider>. The key goes
// into an httpOnly cookie and is never shown again.
export function KeyForm({
  provider,
  onSaved,
  compact = false,
}: {
  provider: KeyProvider;
  onSaved?: () => void;
  compact?: boolean;
}) {
  const p = PROVIDERS[provider];
  const id = useId();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const key = value.trim();
    if (!key) {
      setMessage({ ok: false, text: `Paste your ${p.name} key first.` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await fetchJson(`/api/settings/${provider}`, { method: "POST", body: JSON.stringify({ key }) });
      setValue("");
      setMessage({ ok: true, text: "Saved in this browser." });
      announceSettingsChanged();
      onSaved?.();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-2">
      <label htmlFor={id} className={compact ? "sr-only" : "block font-condensed text-[11px] font-medium text-dim"}>
        {p.name} API key
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          placeholder={`Paste your ${p.name} key`}
          aria-describedby={`${id}-msg`}
          className={`${inputClass} min-w-[12rem] flex-1 font-mono`}
        />
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Saving" : "Save"}
        </Button>
      </div>
      <p id={`${id}-msg`} role="status" className="text-[12px] leading-4">
        {message ? (
          <span className="text-text">
            <span aria-hidden="true">{message.ok ? "✓ " : "! "}</span>
            {message.text}
          </span>
        ) : (
          <a href={p.getKeyUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-dim underline underline-offset-2 hover:text-text">
            {p.getKeyLabel}
            <ArrowSquareOut size={12} aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </p>
    </form>
  );
}
