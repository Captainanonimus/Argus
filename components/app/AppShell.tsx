"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { List, X, MagnifyingGlass } from "@phosphor-icons/react";
import { fetchJson, type StatsResponse, type SymbolsResponse } from "@/lib/clientApi";
import { normalizeTicker } from "./ticker";
import { NAV, matchPage } from "./nav";
import { safeStorage, useSettingsStatus } from "./hooks";

const BANNER_KEY = "argus.firstRunDismissed";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Alt+1..7 jumps to a page; "/" focuses the command box.
  const commandRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const item = NAV.find((n) => e.code === `Digit${n.key}`);
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
        return;
      }
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        commandRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  useEffect(() => setDrawerOpen(false), [pathname]);

  return (
    <div data-surface="terminal" className="flex min-h-screen flex-col bg-ink font-sans text-text">
      <a
        href="#main"
        className="sr-only z-[500] rounded-[2px] bg-text px-3 py-2 text-ink focus:not-sr-only focus:fixed focus:left-2 focus:top-2"
      >
        Skip to content
      </a>
      <TopBar commandRef={commandRef} onMenu={() => setDrawerOpen(true)} />
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Main" data-print-hide className="hidden w-44 shrink-0 border-r border-seam bg-panel md:block">
          <NavList pathname={pathname} />
        </nav>
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 focus:outline-none">
          <FirstRunBanner pathname={pathname} />
          {children}
        </main>
      </div>
      <FunctionBar pathname={pathname} />
      {drawerOpen && <Drawer pathname={pathname} onClose={() => setDrawerOpen(false)} />}
    </div>
  );
}

function NavList({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="py-2">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={`flex h-8 items-center gap-2 px-3 font-condensed text-[13px] font-medium ${
                active ? "bg-panelhi text-text" : "text-dim hover:bg-panelhi hover:text-text"
              }`}
            >
              <span className="num w-4 text-[11px] text-dim" aria-hidden="true">
                {item.key}
              </span>
              <span>{item.label}</span>
              {active && <span className="ml-auto h-3 w-px bg-text" aria-hidden="true" />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function TopBar({
  commandRef,
  onMenu,
}: {
  commandRef: React.RefObject<HTMLInputElement>;
  onMenu: () => void;
}) {
  return (
    <header data-print-hide className="sticky top-0 z-[100] flex h-11 shrink-0 items-center gap-2 border-b border-seam bg-ink px-2 sm:gap-3 sm:px-3">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open navigation"
        className="inline-flex h-8 w-8 items-center justify-center rounded-[2px] text-text hover:bg-panelhi md:hidden"
      >
        <List size={18} aria-hidden="true" />
      </button>
      <Link href="/" className="shrink-0 rounded-[2px] font-condensed text-[15px] font-semibold tracking-[0.08em] text-text">
        ARGUS
      </Link>
      <CommandBox inputRef={commandRef} />
      <StatusChips />
      <Clock />
    </header>
  );
}

function CommandBox({ inputRef }: { inputRef: React.RefObject<HTMLInputElement> }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [symbols, setSymbols] = useState<string[]>([]);

  useEffect(() => {
    fetchJson<SymbolsResponse>("/api/symbols")
      .then((d) => setSymbols(d.symbols.map((s) => s.symbol)))
      .catch(() => setSymbols([]));
  }, []);

  const submit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      const raw = value.trim();
      if (!raw) return;
      const page = matchPage(raw);
      if (page) {
        router.push(page.href);
        setValue("");
        setHint(null);
        return;
      }
      const ticker = normalizeTicker(raw);
      if (ticker) {
        router.push(`/dashboard?symbol=${encodeURIComponent(ticker)}`);
        setValue("");
        setHint(symbols.includes(ticker) ? null : `${ticker} has no data yet`);
        return;
      }
      setHint(`Nothing matches "${raw.slice(0, 24)}". Try a symbol or a page name.`);
    },
    [value, router, symbols],
  );

  return (
    <form role="search" onSubmit={submit} className="relative min-w-0 flex-1 sm:max-w-md">
      <label htmlFor="command" className="sr-only">
        Command: type a symbol or page name and press Enter
      </label>
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[13px] text-dim" aria-hidden="true">
        &gt;
      </span>
      <input
        id="command"
        ref={inputRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setHint(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setValue("");
            (e.target as HTMLInputElement).blur();
          }
        }}
        list="command-suggestions"
        autoComplete="off"
        spellCheck={false}
        placeholder="Symbol or page, then Enter"
        aria-describedby="command-hint"
        className="h-8 w-full rounded-[2px] border border-seam bg-panel pl-6 pr-14 font-mono text-[13px] uppercase text-text placeholder:normal-case placeholder:text-dim/70 hover:border-dim"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 text-dim sm:flex" aria-hidden="true">
        <MagnifyingGlass size={12} />
        <kbd className="num rounded-[2px] border border-seam px-1 text-[10px]">/</kbd>
      </span>
      <datalist id="command-suggestions">
        {symbols.map((s) => (
          <option key={s} value={s} />
        ))}
        {NAV.map((n) => (
          <option key={n.href} value={n.label} />
        ))}
      </datalist>
      <p id="command-hint" role="status" className={hint ? "absolute left-0 top-9 z-[200] whitespace-nowrap rounded-[2px] border border-seam bg-panel px-2 py-1 text-[12px] text-text" : "sr-only"}>
        {hint ?? ""}
      </p>
    </form>
  );
}

function Chip({ label, value, ok, href }: { label: string; value: string; ok: boolean | null; href: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex h-7 items-center gap-1.5 rounded-[2px] border px-2 font-condensed text-[12px] ${
        ok === false ? "border-ask/70 text-text" : "border-seam text-text hover:border-dim"
      }`}
      aria-label={`${label}: ${value}`}
    >
      <span aria-hidden="true" className={ok === false ? "text-text" : "text-dim"}>
        {ok === null ? "…" : ok ? "●" : "○"}
      </span>
      <span className="text-dim">{label}</span>
      <span className="hidden lg:inline">{value}</span>
    </Link>
  );
}

function StatusChips() {
  const { status, error } = useSettingsStatus();
  const known = status !== null;
  return (
    <div className="ml-auto hidden items-center gap-1.5 sm:flex" aria-label="System status">
      <Chip
        label="Database"
        value={error ? "unreachable" : !known ? "checking" : status.db ? "connected" : "down"}
        ok={error ? false : known ? status.db : null}
        href="/settings"
      />
      <Chip
        label="AI models"
        value={!known ? "checking" : status.openrouter ? "key set" : "no key"}
        ok={known ? status.openrouter : null}
        href="/settings#openrouter"
      />
      <Chip
        label="Web search"
        value={!known ? "checking" : status.tinyfish ? "key set" : "no key"}
        ok={known ? status.tinyfish : null}
        href="/settings#tinyfish"
      />
    </div>
  );
}

function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="num hidden shrink-0 text-[12px] text-dim xl:inline" aria-label="UTC time">
      {now} UTC
    </span>
  );
}

function FunctionBar({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Shortcuts" data-print-hide className="hidden h-7 shrink-0 items-stretch border-t border-seam bg-ink md:flex">
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            title={`Alt+${item.key}`}
            className={`flex items-center gap-1.5 border-r border-seam px-2 font-condensed text-[12px] ${
              active ? "bg-panelhi text-text" : "text-dim hover:bg-panelhi hover:text-text"
            }`}
          >
            <kbd className="num rounded-[2px] bg-seam px-1 text-[10px] text-text">{item.key}</kbd>
            {item.label}
          </Link>
        );
      })}
      <span className="ml-auto flex items-center px-3 font-condensed text-[11px] text-dim">
        Alt+number jumps to a page
        <kbd className="num ml-3 mr-1 rounded-[2px] border border-seam px-1 text-[10px]">/</kbd> command
      </span>
    </nav>
  );
}

function Drawer({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panelRef.current) {
        const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>("a,button"));
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[400] md:hidden">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute inset-y-0 left-0 w-64 max-w-[85vw] border-r border-seam bg-panel"
      >
        <div className="flex h-11 items-center justify-between border-b border-seam px-3">
          <span className="font-condensed text-[15px] font-semibold tracking-[0.08em]">ARGUS</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-[2px] hover:bg-panelhi"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <NavList pathname={pathname} onNavigate={onClose} />
        <MobileStatus />
      </div>
    </div>
  );
}

function MobileStatus() {
  const { status } = useSettingsStatus();
  if (!status) return null;
  const row = (label: string, ok: boolean) => (
    <li className="flex justify-between">
      <span className="text-dim">{label}</span>
      <span>
        <span aria-hidden="true">{ok ? "● " : "○ "}</span>
        {ok ? "ready" : "not set"}
      </span>
    </li>
  );
  return (
    <ul className="mx-3 mt-2 space-y-1 border-t border-seam pt-3 font-condensed text-[12px]">
      {row("Database", status.db)}
      {row("AI models", status.openrouter)}
      {row("Web search", status.tinyfish)}
    </ul>
  );
}

function FirstRunBanner({ pathname }: { pathname: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (safeStorage("local").get(BANNER_KEY) === "1") return;
    let cancelled = false;
    fetchJson<StatsResponse>("/api/stats")
      .then((s) => {
        if (!cancelled) setShow(s.totals.events === 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (!show || pathname.startsWith("/simulator")) return null;
  return (
    <div data-print-hide className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-seam bg-panelhi px-3 py-2 sm:px-4">
      <p className="text-[13px] leading-[18px] text-text">
        <span className="font-semibold">New here?</span> There is no order flow yet. Run a scenario in the simulator to
        generate events and see the rules fire.
      </p>
      <div className="ml-auto flex items-center gap-2">
        <Link href="/simulator" className="inline-flex h-7 items-center rounded-[2px] bg-text px-2 font-condensed text-[13px] font-semibold text-ink">
          Open the simulator
        </Link>
        <button
          type="button"
          onClick={() => {
            safeStorage("local").set(BANNER_KEY, "1");
            setShow(false);
          }}
          className="inline-flex h-7 items-center rounded-[2px] px-2 font-condensed text-[13px] text-dim hover:bg-panel hover:text-text"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
