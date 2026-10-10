"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionStyle,
  type MotionValue,
} from "framer-motion";
import { OrderBookLadder } from "@/components/market/OrderBookLadder";
import { TerminalWorkspace } from "@/components/market/TerminalWorkspace";

const PARCHMENT = { bg: "#FBF7F1", fg: "#1A1614", muted: "#6B625C", rule: "#E6DDD1", surface: "#F4EEE5" };
const INK = { bg: "#0A0C10", fg: "#D7DCE5", muted: "#8A93A3", rule: "#232833", surface: "#12151C" };

// Light smoothing so wheel steps don't make the sequences stutter.
const SPRING = { stiffness: 260, damping: 40, mass: 0.4 };

const CONTAINER = "mx-auto w-full max-w-[88rem] px-4 sm:px-6 lg:px-10";
const H2 =
  "font-display text-[clamp(2.25rem,1.6rem+2.6vw,3.75rem)] font-medium leading-[1.08] tracking-[-0.025em] text-balance text-m-fg";
const BODY = "mt-6 max-w-[62ch] text-[1.0625rem] leading-[1.6] text-m-muted [text-wrap:pretty]";

/** Scroll progress, spring-smoothed; a fixed 1 (final state) under reduced motion. */
function useSequence(raw: MotionValue<number>, reduce: boolean) {
  const smooth = useSpring(raw, SPRING);
  const done = useMotionValue(1);
  return reduce ? done : smooth;
}

export default function Home() {
  // Read after mount so server and client markup match on hydration.
  const prefersReduced = useReducedMotion();
  const [reduce, setReduce] = useState(false);
  useEffect(() => setReduce(Boolean(prefersReduced)), [prefersReduced]);

  // Sequence 3 drives the whole page palette, so everything above the
  // terminal crossfades with it and nothing is left low-contrast.
  const handoffRef = useRef<HTMLElement>(null);
  const { scrollYProgress: handoffRaw } = useScroll({
    target: handoffRef,
    offset: ["start 0.9", "start 0.2"],
  });
  const handoffSmooth = useSpring(handoffRaw, SPRING);
  // Colour change aids comprehension, so it stays scroll-linked under reduced motion.
  const handoff = reduce ? handoffRaw : handoffSmooth;

  const bg = useTransform(handoff, [0, 1], [PARCHMENT.bg, INK.bg]);
  const surface = useTransform(handoff, [0, 1], [PARCHMENT.surface, INK.surface]);
  const rule = useTransform(handoff, [0.3, 0.9], [PARCHMENT.rule, INK.rule]);
  // Text flips late, where the background is dark enough for light text.
  const fg = useTransform(handoff, [0.7, 0.9], [PARCHMENT.fg, INK.fg]);
  const muted = useTransform(handoff, [0.7, 0.9], [PARCHMENT.muted, INK.muted]);

  // Keep overscroll areas in step with the page so the edges never jump.
  useMotionValueEvent(bg, "change", (v) => {
    document.body.style.backgroundColor = v;
  });
  useEffect(() => {
    document.body.style.backgroundColor = bg.get();
    return () => {
      document.body.style.backgroundColor = "";
    };
  }, [bg]);

  const palette = {
    backgroundColor: bg,
    color: fg,
    "--m-bg": bg,
    "--m-fg": fg,
    "--m-muted": muted,
    "--m-rule": rule,
    "--m-surface": surface,
  } as MotionStyle;

  return (
    <motion.div data-surface="marketing" className="min-h-full font-sans antialiased" style={palette}>
      <header className={`${CONTAINER} flex h-16 items-center justify-between`}>
        <Link
          href="/"
          className="rounded-[2px] text-lg font-semibold tracking-[-0.01em] text-m-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--m-fg)]"
        >
          Argus
        </Link>
        <Link href="/dashboard" className="link-secondary text-sm">
          Terminal
        </Link>
      </header>

      <main>
        <Hero reduce={reduce} />
        <DualBrain reduce={reduce} />
        <Handoff sectionRef={handoffRef} reduce={reduce} />
      </main>

      <footer className={`${CONTAINER} flex flex-col gap-2 border-t border-seam py-10 text-sm text-dim sm:flex-row sm:justify-between`}>
        <p>Argus trade surveillance</p>
        <p>Workspace figures on this page use sample data.</p>
      </footer>
    </motion.div>
  );
}

/* 1. Hero ------------------------------------------------------------------ */

function Hero({ reduce }: { reduce: boolean }) {
  const ladderRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  // The sequence finishes when the ladder's centre reaches 30% of the
  // viewport, so it plays out while the ladder is fully in view.
  const end = useMotionValue(360);

  useEffect(() => {
    const measure = () => {
      const el = ladderRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const centre = r.top + window.scrollY + r.height / 2;
      end.set(Math.max(280, centre - window.innerHeight * 0.3));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [end]);

  const raw = useTransform([scrollY, end], ([y, e]: number[]) => Math.min(1, Math.max(0, y / e)));
  const progress = useSequence(raw, reduce);

  return (
    <section className={`${CONTAINER} grid gap-x-10 pb-24 pt-14 lg:grid-cols-12 lg:pb-32 lg:pt-24`}>
      <h1 className="font-display text-[clamp(2.75rem,1.6rem+4.6vw,5.5rem)] font-medium leading-[1.02] tracking-[-0.035em] text-balance text-m-fg lg:col-span-10">
        Catch the spoof before it disappears.
      </h1>

      <div className="mt-8 lg:col-span-5 lg:mt-12">
        <p className="max-w-[46ch] text-xl leading-[1.5] text-m-fg [text-wrap:pretty]">
          Argus watches live order flow and flags quote stuffing and spoofing the moment they cross a
          statistical threshold. Market surveillance is a legal duty for exchanges, brokers and prop
          firms, under SEBI in India and the SEC and FINRA in the US.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-5">
          <Link href="/dashboard" className="btn-primary">
            Open the live terminal
          </Link>
          <Link href="/rules" className="link-secondary">
            See how a verdict is reached
          </Link>
        </div>
      </div>

      <div ref={ladderRef} className="mt-16 max-w-[34rem] lg:col-span-6 lg:col-start-7 lg:mt-12">
        <OrderBookLadder progress={progress} />
      </div>
    </section>
  );
}

/* 2. Dual brain ------------------------------------------------------------ */

type Segment = { t: string; mono?: boolean };
type Line = Segment[];

// One plain sentence per model: a gray-zone imbalance that sits between the
// REVIEW (1.5) and FLAG (3) z-score thresholds.
const PRIMARY: Line[] = [
  [
    { t: "Order-book imbalance on " },
    { t: "SMPL", mono: true },
    { t: " reached a z-score of " },
    { t: "2.4", mono: true },
    { t: ", above the " },
    { t: "1.5", mono: true },
    { t: " review threshold but short of the " },
    { t: "3", mono: true },
    { t: " needed to flag it." },
  ],
];

const SECONDARY: Line[] = [
  [
    { t: "Nothing in venue or account context explains the " },
    { t: "2.4", mono: true },
    { t: " imbalance, so it stays in the gray zone between " },
    { t: "1.5", mono: true },
    { t: " and " },
    { t: "3", mono: true },
    { t: " and needs an analyst to look." },
  ],
];

type Verdict = "CLEAR" | "REVIEW" | "FLAG";

function DualBrain({ reduce }: { reduce: boolean }) {
  const panelsRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: panelsRef, offset: ["start 0.85", "end 0.6"] });
  const progress = useSequence(scrollYProgress, reduce);
  const tagOpacity = useTransform(progress, [0.86, 0.96], [0, 1]);
  const tagY = useTransform(progress, [0.86, 0.96], [8, 0]);

  return (
    <section id="verdict" className={`${CONTAINER} scroll-mt-8 pb-16 pt-24 lg:pt-32`}>
      <div className="lg:w-7/12">
        <h2 className={H2}>Two models read every alert. Both have to agree.</h2>
        <p className={BODY}>
          The primary model reconstructs the order&apos;s lifecycle. A second model, trained separately and
          never shown the first one&apos;s answer, reads the same events against venue and account context.
          An alert reaches your queue only when both land on the same call.
        </p>
      </div>

      <div ref={panelsRef} className="mt-14 grid gap-4 md:grid-cols-2 lg:gap-6">
        <BrainPanel
          name="Primary Brain"
          lens="Reads the order lifecycle"
          lines={PRIMARY}
          progress={progress}
          stream={[0.04, 0.46]}
          verdictAt={0.5}
          verdict="REVIEW"
          confidence="0.94"
        />
        <BrainPanel
          name="Secondary Brain"
          lens="Reads venue and account context"
          lines={SECONDARY}
          progress={progress}
          stream={[0.28, 0.7]}
          verdictAt={0.74}
          verdict="REVIEW"
          confidence="0.91"
        />
      </div>

      <motion.div className="mt-8" style={{ opacity: tagOpacity, y: tagY }}>
        <span className="inline-flex rounded p-[1.5px]" style={{ background: "var(--m-gradient)" }}>
          <span className="rounded-[3px] bg-m-bg px-3 py-1.5 text-sm font-medium text-m-fg">
            Verified by two independent models
          </span>
        </span>
      </motion.div>
    </section>
  );
}

function BrainPanel({
  name,
  lens,
  lines,
  progress,
  stream,
  verdictAt,
  verdict,
  confidence,
}: {
  name: string;
  lens: string;
  lines: Line[];
  progress: MotionValue<number>;
  stream: [number, number];
  verdictAt: number;
  verdict: Verdict;
  confidence: string;
}) {
  const total = lines.reduce((n, line) => n + line.reduce((m, s) => m + s.t.length, 0), 0);
  const chars = useTransform(progress, stream, [0, total]);
  const [shown, setShown] = useState(0);

  useMotionValueEvent(chars, "change", (v) => setShown(Math.floor(v)));
  useEffect(() => setShown(Math.floor(chars.get())), [chars]);

  const verdictOpacity = useTransform(progress, [verdictAt, verdictAt + 0.06], [0, 1]);
  const verdictY = useTransform(progress, [verdictAt, verdictAt + 0.06], [6, 0]);

  // Unrevealed characters stay in the DOM at zero opacity, so wrapping never
  // shifts and assistive tech always gets the full reasoning.
  let budget = shown;

  return (
    <article className="flex flex-col rounded-[2px] bg-m-surface p-6 lg:p-8">
      <h3 className="text-[1.375rem] font-semibold leading-[1.3] tracking-[-0.01em] text-m-fg">{name}</h3>
      <p className="mt-1 text-sm text-m-muted">{lens}</p>

      <ul className="mt-6 space-y-3 border-t border-m-rule pt-6 text-[1.0625rem] leading-[1.5] text-m-fg">
        {lines.map((line, i) => (
          <li key={i}>
            {line.map((seg, j) => {
              const n = Math.max(0, Math.min(seg.t.length, budget));
              budget -= seg.t.length;
              return (
                <span key={j} className={seg.mono ? "font-mono text-[0.95em] tabular" : undefined}>
                  {seg.t.slice(0, n)}
                  <span className="opacity-0">{seg.t.slice(n)}</span>
                </span>
              );
            })}
          </li>
        ))}
      </ul>

      <motion.div
        className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-m-rule pt-6"
        style={{ opacity: verdictOpacity, y: verdictY }}
      >
        <span className="text-sm text-m-muted">Verdict</span>
        <span className="rounded-[2px] bg-m-fg px-2.5 py-1 text-sm font-medium text-m-bg">{verdict}</span>
        <span className="text-sm text-m-muted">
          Confidence <span className="font-mono tabular text-m-fg">{confidence}</span>
        </span>
      </motion.div>
    </article>
  );
}

/* 3. Terminal handoff ------------------------------------------------------ */

function Handoff({
  sectionRef,
  reduce,
}: {
  sectionRef: React.RefObject<HTMLElement>;
  reduce: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: frameRef, offset: ["start 0.85", "center 0.55"] });
  const boot = useSequence(scrollYProgress, reduce);

  return (
    <section ref={sectionRef} className="pb-24 pt-[28vh] lg:pb-32">
      <div className={CONTAINER}>
        <div className="lg:w-7/12">
          <h2 className={H2}>Then open the book it came from.</h2>
          <p className={BODY}>
            Every alert links straight into the workspace: depth, price and the order&apos;s audit trail on
            one screen, tiled the way a surveillance desk already works.
          </p>
        </div>
      </div>

      <div ref={frameRef} className={`${CONTAINER} mt-14`}>
        <TerminalWorkspace boot={boot} />
      </div>

      <div className={`${CONTAINER} mt-12`}>
        <Link href="/dashboard" className="btn-primary">
          Open the live terminal
        </Link>
      </div>
    </section>
  );
}
