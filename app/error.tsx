"use client";

import Link from "next/link";
import { ArrowClockwise } from "@phosphor-icons/react";
import { buttonClass } from "@/components/ui/Button";

const CONTAINER = "mx-auto w-full max-w-[88rem] px-4 sm:px-6 lg:px-10";

export default function RootError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div data-surface="app" className="page-enter flex min-h-screen flex-col bg-ink font-sans text-text antialiased">
      <header className={`${CONTAINER} flex h-16 items-center justify-between`}>
        <Link href="/" className="rounded-[2px] text-lg font-semibold tracking-[-0.01em] text-text">
          Argus
        </Link>
        <Link href="/dashboard" className="link-secondary text-sm">
          Terminal
        </Link>
      </header>
      <main role="alert" className={`${CONTAINER} flex-1 pb-24 pt-14 lg:pt-24`}>
        <h1 className="max-w-[20ch] font-display text-[clamp(2.25rem,1.6rem+2.6vw,3.75rem)] font-medium leading-[1.08] tracking-[-0.025em] [text-wrap:balance]">
          Something went wrong loading this page.
        </h1>
        <p className="mt-6 max-w-[52ch] text-[1.0625rem] leading-[1.6] text-dim">
          The page hit an unexpected error. Try again, or open the live terminal.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-5">
          <button type="button" onClick={reset} className={buttonClass("primary", "lg")}>
            <ArrowClockwise size={16} aria-hidden="true" />
            Try again
          </button>
          <Link href="/dashboard" className="link-secondary">
            Open the live terminal
          </Link>
        </div>
      </main>
    </div>
  );
}
