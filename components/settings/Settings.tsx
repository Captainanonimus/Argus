"use client";

import { useState } from "react";
import { ArrowSquareOut, Trash, Plugs } from "@phosphor-icons/react";
import { errorMessage, fetchJson, type SettingsStatus } from "@/lib/clientApi";
import { announceSettingsChanged, useSettingsStatus } from "@/components/app/hooks";
import { Button, ErrorState, LoadingState, Panel, PageHeader } from "@/components/app/ui";
import { KeyForm, PROVIDERS, type KeyProvider } from "./KeyForm";

type TestResult = { ok: boolean; message?: string; error?: string; results?: number; freeTier?: boolean | null };

export function Settings() {
  const { status, error, reload } = useSettingsStatus();

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Keys are stored in a secure, httpOnly cookie in this browser only. They are sent to the Argus server with each request, never shown again, and never readable by page scripts. Clearing your cookies removes them."
      />
      {error && !status && <ErrorState message={`Could not read settings status. ${error}`} onRetry={reload} />}
      {!status && !error && <LoadingState label="Loading settings" rows={6} />}
      {status && (
        <div className="stagger grid gap-4 lg:grid-cols-2">
          <KeyPanel n={1} provider="openrouter" status={status} />
          <KeyPanel n={2} provider="tinyfish" status={status} />
          <Panel n={3} title="Database" className="lg:col-span-2" bodyClassName="p-4">
            <p className="text-[13px]">
              <span aria-hidden="true" className={status.db ? "text-bid" : "text-ask"}>{status.db ? "● " : "○ "}</span>
              {status.db ? "Connected. Events and alerts are being saved." : "The database is not reachable. Events cannot be saved until it is back."}
            </p>
            <Button size="sm" className="mt-2" onClick={reload}>
              Check again
            </Button>
          </Panel>
        </div>
      )}
    </div>
  );
}

function sourceText(source: "cookie" | "env" | null) {
  if (source === "cookie") return "Saved in this browser";
  if (source === "env") return "Set on the server";
  return "Not set";
}

function KeyPanel({ n, provider, status }: { n: number; provider: KeyProvider; status: SettingsStatus }) {
  const p = PROVIDERS[provider];
  const source = status.sources[provider];
  const [test, setTest] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    setError(null);
    try {
      setTest(await fetchJson<TestResult>(`/api/settings/test-${provider}`));
    } catch (err) {
      setError(`Test failed: ${errorMessage(err)}`);
    } finally {
      setTesting(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    setError(null);
    setTest(null);
    try {
      await fetchJson(`/api/settings/${provider}`, { method: "DELETE" });
      announceSettingsChanged();
    } catch (err) {
      setError(`Could not remove the key: ${errorMessage(err)}`);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Panel n={n} id={provider} title={p.name} meta={sourceText(source)} bodyClassName="space-y-3 p-4">
      <p className="text-[13px] leading-[18px]">{p.purpose}</p>
      <p className="flex items-center gap-2 text-[13px]">
        <span
          className={`inline-flex h-6 items-center gap-1.5 rounded-[2px] border px-2 text-[12px] ${source ? "border-seam" : "border-ask/70"}`}
        >
          <span aria-hidden="true">{source ? "●" : "○"}</span>
          {sourceText(source)}
        </span>
        {source === "env" && <span className="text-[12px] text-dim">A key saved here overrides it.</span>}
      </p>
      <KeyForm provider={provider} onSaved={() => setTest(null)} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={runTest} disabled={testing || !source}>
          <Plugs size={14} aria-hidden="true" />
          {testing ? "Testing" : "Test key"}
        </Button>
        <Button size="sm" variant="danger" onClick={remove} disabled={removing || source !== "cookie"}>
          <Trash size={14} aria-hidden="true" />
          {removing ? "Removing" : "Remove from this browser"}
        </Button>
        <a
          href={p.signUpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-7 items-center gap-1 px-1 text-[12px] text-dim underline underline-offset-2 hover:text-text"
        >
          {provider === "tinyfish" ? "Sign up at TinyFish" : "Open OpenRouter"}
          <ArrowSquareOut size={12} aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <p role="status" className="text-[13px] leading-[18px]">
        {test &&
          (test.ok ? (
            <>
              <span aria-hidden="true">✓ </span>
              {provider === "tinyfish"
                ? `Key works. A test search returned ${test.results ?? 0} result${test.results === 1 ? "" : "s"}.`
                : `Key works${test.freeTier === true ? " (free tier)" : ""}.`}
            </>
          ) : (
            <span className="inline-flex rounded-[2px] border border-ask/70 px-2 py-1">
              <span aria-hidden="true">!&nbsp;</span>
              {test.message ?? "The key did not work."}
            </span>
          ))}
      </p>
      {error && <ErrorState compact message={error} />}
      {source === "env" && (
        <p className="text-[12px] text-dim">Removing is only possible for keys saved in this browser. Server keys are set in the deployment environment.</p>
      )}
    </Panel>
  );
}
