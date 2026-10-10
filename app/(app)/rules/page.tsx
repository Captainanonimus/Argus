import type { Metadata } from "next";
import Link from "next/link";
import { RULES, THRESHOLDS } from "@/lib/rules";

export const metadata: Metadata = { title: "Rules" };

const T = THRESHOLDS;

export default function RulesPage() {
  return (
    <div>
      <div className="border-b border-seam bg-ink px-3 py-3 sm:px-4">
        <h1 className="font-condensed text-[18px] font-semibold leading-6">Surveillance rules</h1>
        <p className="mt-1 max-w-[80ch] text-[13px] leading-[18px] text-dim">
          Every order event is checked against three rules the moment it is saved. Each check re-reads the recent
          window for that symbol from the database, so results do not depend on which server handled the event. These
          pages describe the rules; they cannot be edited here.
        </p>
      </div>

      <div className="grid gap-px bg-seam">
        {RULES.map((r, i) => (
          <section key={r.type} aria-labelledby={`rule-${r.type}`} className="bg-panel">
            <header className="flex h-7 items-center gap-2 border-b border-seam px-3">
              <span className="num text-[11px] text-dim" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 id={`rule-${r.type}`} className="font-condensed text-[14px] font-semibold">
                {r.name}
              </h2>
              <span className="num text-[11px] text-dim">{r.code}</span>
              <Link
                href={`/simulator`}
                className="ml-auto rounded-[2px] px-1.5 font-condensed text-[12px] text-dim hover:bg-panelhi hover:text-text"
              >
                Try it in the simulator
              </Link>
            </header>
            <dl className="grid gap-x-6 gap-y-3 p-3 md:grid-cols-[10rem_1fr]">
              <dt className="font-condensed text-[12px] font-medium text-dim">What it measures</dt>
              <dd className="max-w-[80ch] text-[13px] leading-[18px]">{r.what}</dd>
              <dt className="font-condensed text-[12px] font-medium text-dim">Threshold</dt>
              <dd className="max-w-[80ch] text-[13px] leading-[18px]">{r.threshold}</dd>
              <dt className="font-condensed text-[12px] font-medium text-dim">Why it matters</dt>
              <dd className="max-w-[80ch] text-[13px] leading-[18px]">{r.why}</dd>
              <dt className="font-condensed text-[12px] font-medium text-dim">Example</dt>
              <dd className="max-w-[80ch] rounded-[2px] border border-seam bg-ink p-2 text-[13px] leading-[18px]">{r.example}</dd>
            </dl>
          </section>
        ))}

        <section aria-labelledby="rule-common" className="bg-panel">
          <header className="flex h-7 items-center gap-2 border-b border-seam px-3">
            <span className="num text-[11px] text-dim" aria-hidden="true">04</span>
            <h2 id="rule-common" className="font-condensed text-[14px] font-semibold">
              Verdicts, statuses and limits
            </h2>
          </header>
          <ul className="max-w-[90ch] list-disc space-y-1.5 py-3 pl-8 pr-3 text-[13px] leading-[18px]">
            <li>
              <span className="font-semibold">CLEAR</span> means no rule fired. <span className="font-semibold">FLAG</span>{" "}
              means a threshold was crossed. <span className="font-semibold">REVIEW</span> means an analyst should look:
              the two models disagreed, or they could not be reached.
            </li>
            <li>
              Alerts of the same rule on the same symbol are saved at most once every {T.dedupeS} seconds, so a burst
              produces one case rather than dozens. Each event still reports its own verdict.
            </li>
            <li>
              The gray-zone model check runs at most once per symbol per minute; later events in that minute reuse the
              answer.
            </li>
            <li>
              Cases move from Open to Investigating, then to Escalated or Dismissed. Notes are saved with the case and
              included in the CSV export.
            </li>
            <li>
              Alerts are statistical signals for human review. They are not findings of misconduct, and the thresholds
              are a starting point to be calibrated against each venue&apos;s normal behaviour.
            </li>
          </ul>
        </section>
      </div>
    </div>
  );
}
