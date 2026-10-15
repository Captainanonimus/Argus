// Backtests the surveillance engine on recorded data with labelled injections.
//   npm run backtest -- [--symbols BTCUSDT,ETHUSDT] [--from -1h] [--to <iso>]
//                       [--speed max] [--per-rule 3] [--intensity 2]
//                       [--max-burst 5000] [--no-ai] [--keep]
//
// Writes the JSON result to data/backtests/<runId>.json and
// data/backtests/latest.json (shown at /backtest), and prints it to stdout
// with --print. Replay data is deleted afterwards unless --keep is given.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/prisma";
import { requireWritableDb } from "./db-guard";
import { runBacktest } from "../lib/backtest";
import { cliArg, cliFlag, deleteReplayRun, parseSpeed, parseTime, recordedRange } from "../lib/replay";

const OUT_DIR = path.join(process.cwd(), "data", "backtests");

function num(name: string, fallback: number) {
  const v = cliArg(name);
  if (v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid --${name}: ${v}`);
  return n;
}

const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
const secs = (ms: number | undefined) => (ms === undefined ? "n/a" : `${(ms / 1000).toFixed(1)}s`);

async function main() {
  requireWritableDb("backtest");
  const symbols = (cliArg("symbols") ?? "BTCUSDT,ETHUSDT").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const ai = !cliFlag("no-ai");
  if (!ai) delete process.env.OPENROUTER_API_KEY;

  const range = await recordedRange(symbols);
  if (!range) {
    console.error(`No recorded events for ${symbols.join(", ")}. Run \`npm run record\` first.`);
    process.exitCode = 1;
    return;
  }
  const fromArg = cliArg("from");
  const toArg = cliArg("to");

  const result = await runBacktest({
    symbols,
    from: fromArg ? parseTime(fromArg) : range.from,
    to: toArg ? parseTime(toArg) : range.to,
    speed: parseSpeed(cliArg("speed"), 0),
    injectionsPerRule: Math.floor(num("per-rule", 3)),
    intensity: num("intensity", 2),
    maxBurstOrders: Math.floor(num("max-burst", 5000)),
    ai,
    log: (l) => console.log(l),
  });

  await mkdir(OUT_DIR, { recursive: true });
  const json = JSON.stringify(result, null, 2);
  await writeFile(path.join(OUT_DIR, `${result.runId}.json`), json);
  await writeFile(path.join(OUT_DIR, "latest.json"), json);

  if (cliFlag("print")) console.log(json);

  console.log(`\nBacktest ${result.runId}: ${result.replay.evaluated} events over ${result.dataHours.toFixed(2)}h x ${symbols.length} symbols`);
  console.log("  rule            injected detected recall  alerts  precision  latency p50 / p95");
  for (const r of result.rules) {
    console.log(
      `  ${r.rule.padEnd(15)} ${String(r.injected).padStart(8)} ${String(r.detected).padStart(8)} ${pct(r.recall).padStart(6)} ${String(r.alerts).padStart(7)} ${pct(r.precision).padStart(10)}  ${secs(r.latencyMs?.median)} / ${secs(r.latencyMs?.p95)}`,
    );
  }
  const dm = result.dualModel;
  console.log(`  dual-model: ${dm.runs} gray-zone runs, ${dm.bothAnswered} with two answers, agreement ${pct(dm.agreementRate)} ${JSON.stringify(dm.outcomes)}`);
  console.log(`  engine errors: ${result.replay.engineErrors}`);
  console.log(`\nWrote ${path.relative(process.cwd(), path.join(OUT_DIR, "latest.json"))}`);

  if (cliFlag("keep")) {
    console.log(`Kept replay data under symbol prefix ${result.replay.prefix}`);
  } else {
    const removed = await deleteReplayRun(result.replay.prefix);
    console.log(`Cleaned up ${removed.events} replay events and ${removed.alerts} alerts`);
  }
}

main()
  .catch((err) => {
    console.error("backtest failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
