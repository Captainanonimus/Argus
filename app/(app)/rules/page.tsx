import type { Metadata } from "next";
import Link from "next/link";
import { RULES, THRESHOLDS } from "@/lib/rules";
import { PageHeader } from "@/components/ui/PageHeader";
import { cardClass } from "@/components/ui/Card";

export const metadata: Metadata = { title: "Rules" };

const T = THRESHOLDS;

export default function RulesPage() {
  return (
    <div>
      <PageHeader
        title="Surveillance rules"
        description="Every order event is checked against three rules the moment it is saved. Each check re-reads the recent window for that symbol from the database, so results do not depend on which server handled the event. These pages describe the rules; they cannot be edited here."
      />

      <div className="stagger grid gap-4">
        {RULES.map((r, i) => (
          <section key={r.type} aria-labelledby={`rule-${r.type}`} className={cardClass()}>
            <header className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b border-seam px-4 py-2">
              <span className="num text-[11px] text-dim" aria-hidden="true">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 id={`rule-${r.type}`} className="text-sm font-semibold">
                {r.name}
              </h2>
              <span className="num text-[11px] text-dim">{r.code}</span>
              <Link
                href={`/simulator`}
                className="ml-auto rounded-[2px] text-[13px] text-text underline decoration-1 underline-offset-[3px] hover:decoration-2"
              >
                Try it in the simulator
              </Link>
            </header>
            <dl className="grid gap-x-6 gap-y-3 p-4 md:grid-cols-[10rem_1fr]">
              <dt className="text-[12px] font-medium text-dim">What it measures</dt>
              <dd className="max-w-[80ch] text-[13px] leading-[18px]">{r.what}</dd>
              <dt className="text-[12px] font-medium text-dim">Threshold</dt>
              <dd className="max-w-[80ch] text-[13px] leading-[18px]">{r.threshold}</dd>
              <dt className="text-[12px] font-medium text-dim">Why it matters</dt>
              <dd className="max-w-[80ch] text-[13px] leading-[18px]">{r.why}</dd>
              <dt className="text-[12px] font-medium text-dim">Example</dt>
              <dd className="max-w-[80ch] rounded-[2px] border border-seam bg-ink p-3 text-[13px] leading-[18px]">{r.example}</dd>
            </dl>
          </section>
        ))}

        <section aria-labelledby="rule-common" className={cardClass()}>
          <header className="flex min-h-11 flex-wrap items-center gap-x-2 gap-y-1 border-b border-seam px-4 py-2">
            <span className="num text-[11px] text-dim" aria-hidden="true">04</span>
            <h2 id="rule-common" className="text-sm font-semibold">
              Verdicts, statuses and limits
            </h2>
          </header>
          <ul className="max-w-[90ch] list-disc space-y-1.5 py-4 pl-8 pr-4 text-[13px] leading-[19px]">
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
