import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";

export const metadata: Metadata = { title: "Page not found | Argus" };

const CONTAINER = "mx-auto w-full max-w-[88rem] px-4 sm:px-6 lg:px-10";

export default function NotFound() {
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
      <main className={`${CONTAINER} flex-1 pb-24 pt-14 lg:pt-24`}>
        <p className="num text-sm text-dim">404</p>
        <h1 className="mt-2 max-w-[18ch] font-display text-[clamp(2.25rem,1.6rem+2.6vw,3.75rem)] font-medium leading-[1.08] tracking-[-0.025em] [text-wrap:balance]">
          This page is not on the tape.
        </h1>
        <p className="mt-6 max-w-[52ch] text-[1.0625rem] leading-[1.6] text-dim">
          The page you asked for does not exist or has moved. The live terminal and the alert queue are a click away.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-5">
          <Link href="/dashboard" className={buttonClass("primary", "lg")}>
            Open the live terminal
          </Link>
          <Link href="/" className="link-secondary">
            Back to the home page
          </Link>
        </div>
      </main>
    </div>
  );
}
