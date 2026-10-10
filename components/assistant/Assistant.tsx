"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowSquareOut, Check, Copy, PaperPlaneRight, Stop, Trash, X } from "@phosphor-icons/react";
import { errorMessage, fetchJson, isAbortError, type AlertCaseResponse, type SymbolsResponse } from "@/lib/clientApi";
import { alertTypeLabel } from "@/lib/format";
import { safeStorage, useSettingsStatus } from "@/components/app/hooks";
import { Button, ErrorState, Label, Panel, PageHeader, VerdictBadge, buttonClass, inputClass } from "@/components/app/ui";
import { KeyForm } from "@/components/settings/KeyForm";
import { Markdown } from "./Markdown";

const STORE_KEY = "argus.assistant.v1";
const MAX_STORED = 40;
const HISTORY_SENT = 20;

type Source = { n: number; title: string; url: string; snippet: string; site: string };
type Notice = { code: string; message: string };

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
  model?: string | null;
  notices?: Notice[];
  usedWeb?: boolean;
  failed?: boolean;
};

type ChatResponse = { reply: string; sources: Source[]; usedWeb: boolean; model: string | null; notices: Notice[] };

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function loadStored(): { messages: Msg[]; useWeb: boolean } {
  const raw = safeStorage("session").get(STORE_KEY);
  if (!raw) return { messages: [], useWeb: false };
  try {
    const data = JSON.parse(raw) as { messages?: unknown; useWeb?: unknown };
    const messages = Array.isArray(data.messages)
      ? (data.messages as Msg[]).filter(
          (m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && typeof m.id === "string",
        )
      : [];
    return { messages: messages.slice(-MAX_STORED), useWeb: data.useWeb === true };
  } catch {
    return { messages: [], useWeb: false };
  }
}

const GENERAL_PROMPTS = [
  "Summarise the open alerts and which symbols need attention first.",
  "Which symbol has the most FLAG verdicts, and what rule drove them?",
  "Explain how the spoofing rule decides to flag a cancel.",
  "What do regulators expect a firm to do about quote stuffing?",
];

export function Assistant() {
  const params = useSearchParams();
  const router = useRouter();
  const alertParam = params?.get("alert") ?? "";
  const alertId = ID_RE.test(alertParam) ? alertParam : null;

  const { status } = useSettingsStatus();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [useWeb, setUseWeb] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [symbol, setSymbol] = useState("");
  const [symbols, setSymbols] = useState<string[]>([]);
  const [caseInfo, setCaseInfo] = useState<AlertCaseResponse | null>(null);
  const [caseError, setCaseError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Restore this tab's conversation.
  useEffect(() => {
    const s = loadStored();
    setMessages(s.messages);
    setUseWeb(s.useWeb);
    setHydrated(true);
  }, []);
  useEffect(() => {
    if (!hydrated) return;
    safeStorage("session").set(STORE_KEY, JSON.stringify({ messages: messages.slice(-MAX_STORED), useWeb }));
  }, [messages, useWeb, hydrated]);

  useEffect(() => {
    fetchJson<SymbolsResponse>("/api/symbols")
      .then((d) => setSymbols(d.symbols.map((s) => s.symbol)))
      .catch(() => setSymbols([]));
  }, []);

  // Preload the case and prefill a prompt.
  useEffect(() => {
    setCaseInfo(null);
    setCaseError(null);
    if (!alertId) return;
    const c = new AbortController();
    fetchJson<AlertCaseResponse>(`/api/alerts/${alertId}`, { signal: c.signal })
      .then((d) => {
        setCaseInfo(d);
        setInput(
          (cur) =>
            cur ||
            `Explain why this ${alertTypeLabel(d.alert.alertType).toLowerCase()} alert on ${d.event.symbol} was raised, what the numbers mean, and what I should check next.`,
        );
        inputRef.current?.focus();
      })
      .catch((err) => {
        if (!isAbortError(err)) setCaseError(errorMessage(err));
      });
    return () => c.abort();
  }, [alertId]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, pending]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const [, force] = useState(0);
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [pending]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || pending) return;
    const userMsg: Msg = { id: newId(), role: "user", content };
    const history = [...messages.filter((m) => !m.failed), userMsg].slice(-HISTORY_SENT);
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setRequestError(null);
    setPending(true);
    setStartedAt(Date.now());
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const r = await fetchJson<ChatResponse>("/api/chat", {
        method: "POST",
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          alertId: caseInfo ? alertId : null,
          symbol: symbol || null,
          useWeb,
        }),
        signal: controller.signal,
      });
      const reply = r.reply?.trim();
      setMessages((m) => [
        ...m,
        {
          id: newId(),
          role: "assistant",
          content: reply || "No answer this time.",
          sources: r.sources,
          model: r.model,
          notices: r.notices,
          usedWeb: r.usedWeb,
          failed: !reply,
        },
      ]);
    } catch (err) {
      if (isAbortError(err)) {
        setMessages((m) => [...m, { id: newId(), role: "assistant", content: "Stopped before an answer arrived.", failed: true }]);
      } else {
        setRequestError(`The assistant request failed: ${errorMessage(err)}`);
        setMessages((m) => m.filter((x) => x.id !== userMsg.id));
        setInput(content);
      }
    } finally {
      setPending(false);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const clearChat = () => {
    controllerRef.current?.abort();
    setMessages([]);
    safeStorage("session").remove(STORE_KEY);
  };

  const prompts = useMemo(() => {
    if (caseInfo) {
      const sym = caseInfo.event.symbol;
      return [
        `Explain why this alert on ${sym} was raised, in plain language.`,
        `Which account drove the activity around this alert, and what did it do?`,
        `Draft a short case note for this alert with the facts so far.`,
        `What do regulators say about ${alertTypeLabel(caseInfo.alert.alertType).toLowerCase()}?`,
      ];
    }
    return GENERAL_PROMPTS;
  }, [caseInfo]);

  const noModelKey = status !== null && !status.openrouter;
  const noWebKey = status !== null && !status.tinyfish;
  const elapsed = pending ? Math.floor((Date.now() - startedAt) / 1000) : 0;

  return (
    <div className="flex min-h-[calc(100vh-2.75rem-1.75rem)] flex-col">
      <PageHeader title="Assistant">
        <Button size="sm" variant="ghost" onClick={clearChat} disabled={messages.length === 0}>
          <Trash size={14} aria-hidden="true" />
          Clear conversation
        </Button>
      </PageHeader>

      <div className="grid flex-1 gap-px bg-seam lg:grid-cols-12">
        <Panel n={1} title="Conversation" meta="answers use Argus data first" className="min-h-[520px] lg:col-span-8" bodyClassName="flex flex-col">
          <div ref={logRef} role="log" aria-label="Conversation" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 lg:max-h-[calc(100vh-15rem)]">
            {messages.length === 0 && !pending && (
              <div className="space-y-3">
                <p className="max-w-[60ch] text-[13px] leading-[18px] text-dim">
                  Ask about alerts, symbols or how the rules work. Answers are grounded in the Argus database
                  {useWeb ? " and, with web search on, in pages found by TinyFish" : ""}. Alerts are statistical signals
                  for human review, and nothing here is legal advice.
                </p>
                <ul className="grid gap-2 sm:grid-cols-2" aria-label="Suggested questions">
                  {prompts.map((p) => (
                    <li key={p}>
                      <button
                        type="button"
                        onClick={() => send(p)}
                        disabled={pending || noModelKey}
                        className="w-full rounded-[2px] border border-seam bg-ink px-3 py-2 text-left text-[13px] leading-[18px] hover:border-dim disabled:opacity-50"
                      >
                        {p}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {messages.map((m) => (
              <MessageView key={m.id} msg={m} />
            ))}
            {pending && (
              <div role="status" className="flex items-center gap-2 text-[13px] text-dim">
                <span className="inline-block h-3 w-3 animate-pulse rounded-[2px] bg-text motion-reduce:animate-none" aria-hidden="true" />
                {useWeb && elapsed < 15 ? "Reading Argus data and searching the web" : "Reading Argus data and writing an answer"}
                <span className="num">{elapsed}s</span>
              </div>
            )}
          </div>

          {requestError && <ErrorState compact message={requestError} />}

          <form onSubmit={onSubmit} className="shrink-0 border-t border-seam p-2">
            <label htmlFor="chat-input" className="sr-only">
              Message the assistant
            </label>
            <textarea
              id="chat-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={3}
              maxLength={8000}
              placeholder={noModelKey ? "Save an OpenRouter key to start chatting" : "Ask about an alert, a symbol or a rule. Enter sends, Shift+Enter adds a line."}
              className="w-full resize-y rounded-[2px] border border-seam bg-ink p-2 text-[13px] leading-[18px] text-text placeholder:text-dim/70"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  role="switch"
                  aria-checked={useWeb}
                  checked={useWeb}
                  onChange={(e) => setUseWeb(e.target.checked)}
                  className="h-4 w-4 accent-[#D7DCE5]"
                />
                Search the web with TinyFish
              </label>
              <div className="ml-auto flex gap-2">
                {pending ? (
                  <Button variant="danger" onClick={() => controllerRef.current?.abort()}>
                    <Stop size={14} aria-hidden="true" />
                    Stop
                  </Button>
                ) : (
                  <Button type="submit" variant="primary" disabled={!input.trim()}>
                    <PaperPlaneRight size={14} aria-hidden="true" />
                    Send
                  </Button>
                )}
              </div>
            </div>
          </form>
        </Panel>

        <div className="flex flex-col gap-px lg:col-span-4">
          <Panel n={2} title="Context" bodyClassName="space-y-3 p-3">
            {alertId && (
              <div className="rounded-[2px] border border-seam bg-ink p-2">
                {caseInfo ? (
                  <>
                    <p className="flex flex-wrap items-center gap-2 text-[13px]">
                      <span className="font-condensed font-semibold">
                        Case: {alertTypeLabel(caseInfo.alert.alertType)} on {caseInfo.event.symbol}
                      </span>
                      <VerdictBadge verdict={caseInfo.alert.verdict} />
                    </p>
                    <p className="mt-1 text-[12px] leading-4 text-dim">The full case, its timeline and notes are sent with each question.</p>
                    <div className="mt-2 flex gap-2">
                      <Link href={`/alerts/${caseInfo.alert.id}`} className={buttonClass("secondary", "sm")}>
                        Open case
                      </Link>
                      <Button size="sm" variant="ghost" onClick={() => router.replace("/assistant")}>
                        <X size={14} aria-hidden="true" />
                        Detach
                      </Button>
                    </div>
                  </>
                ) : caseError ? (
                  <p className="text-[12px]">That case could not be loaded ({caseError}). Questions use general Argus data.</p>
                ) : (
                  <p className="text-[12px] text-dim" role="status">Loading the case.</p>
                )}
              </div>
            )}
            <div>
              <Label htmlFor="chat-scope">Symbol scope</Label>
              <select id="chat-scope" value={symbol} onChange={(e) => setSymbol(e.target.value)} className={`${inputClass} font-mono`}>
                <option value="">All symbols</option>
                {symbols.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </Panel>

          {noModelKey && (
            <Panel n={3} title="Connect the AI models" bodyClassName="space-y-2 p-3">
              <p className="text-[13px] leading-[18px]">
                The assistant runs on free open models through OpenRouter. Paste a key to enable answers. It stays in this
                browser&apos;s secure cookie.
              </p>
              <KeyForm provider="openrouter" compact />
            </Panel>
          )}
          {noWebKey && (
            <Panel n={noModelKey ? 4 : 3} title="Add web search" bodyClassName="space-y-2 p-3">
              <p className="text-[13px] leading-[18px]">
                With a TinyFish key the assistant can search the web and cite the pages it read.{" "}
                <a
                  href="https://agent.tinyfish.ai/sign-up"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 underline underline-offset-2"
                >
                  Sign up for a free key
                  <ArrowSquareOut size={12} aria-hidden="true" />
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </p>
              <KeyForm provider="tinyfish" compact />
            </Panel>
          )}
          <div className="flex-1 bg-panel" />
        </div>
      </div>
    </div>
  );
}

function MessageView({ msg }: { msg: Msg }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  if (msg.role === "user") {
    return (
      <div className="ml-auto max-w-[85%] rounded-[2px] bg-panelhi px-3 py-2">
        <p className="sr-only">You said:</p>
        <p className="whitespace-pre-wrap text-[13px] leading-[19px] [overflow-wrap:anywhere]">{msg.content}</p>
      </div>
    );
  }
  return (
    <div className="max-w-[95%]">
      <div className="mb-1 flex flex-wrap items-center gap-2 font-condensed text-[11px] text-dim">
        <span className="font-semibold text-text">Argus assistant</span>
        {msg.model && <span className="num">{msg.model}</span>}
        {msg.usedWeb && <span>with web sources</span>}
        <button
          type="button"
          onClick={copy}
          aria-label={copied ? "Copied" : "Copy answer"}
          className="ml-auto inline-flex h-6 items-center gap-1 rounded-[2px] px-1.5 hover:bg-panelhi hover:text-text"
        >
          {copied ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <div className={`rounded-[2px] border px-3 py-2 ${msg.failed ? "border-seam text-dim" : "border-seam bg-ink"}`}>
        <Markdown text={msg.content} sources={msg.sources ?? []} />
      </div>
      {msg.notices && msg.notices.length > 0 && (
        <ul className="mt-1.5 space-y-1">
          {msg.notices.map((n, i) => (
            <li key={`${n.code}-${i}`} className="flex gap-1.5 text-[12px] leading-4 text-text">
              <span aria-hidden="true" className="text-dim">!</span>
              <span>
                {n.message}
                {(n.code === "no_openrouter_key" || n.code === "openrouter_unauthorized" || n.code === "no_tinyfish_key") && (
                  <>
                    {" "}
                    <Link href="/settings" className="underline underline-offset-2">
                      Open settings
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {msg.sources && msg.sources.length > 0 && (
        <div className="mt-2">
          <p className="font-condensed text-[11px] text-dim">Web sources (not Argus data)</p>
          <ol className="mt-1 flex flex-wrap gap-1.5">
            {msg.sources.map((s) => (
              <li key={s.n}>
                <a
                  href={/^https?:\/\//i.test(s.url) ? s.url : undefined}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  title={s.snippet || s.title}
                  className="inline-flex max-w-[18rem] items-center gap-1.5 rounded-[2px] border border-seam px-2 py-1 text-[12px] hover:border-dim"
                >
                  <span className="num text-dim">[{s.n}]</span>
                  <span className="truncate">{s.title}</span>
                  <span className="num shrink-0 text-[10px] text-dim">{s.site}</span>
                  <span className="sr-only">(opens in a new tab)</span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
