// Replays recorded events from the DB through the surveillance engine.
//   npm run replay -- [--symbols BTCUSDT,ETHUSDT] [--from -1h] [--to <iso>] [--speed 10|max] [--keep] [--no-ai]
//
// --from / --to accept ISO timestamps, epoch ms or offsets like -30m, -2h.
// Without them the whole recorded range for the symbols is replayed.
// --speed is simulated seconds per wall second (default 1; "max" = unpaced).
// Replayed events and their alerts live under a "RPL-<run>-" symbol and are
// deleted at the end unless --keep is given.

import { prisma } from "../lib/prisma";
import {
  cliArg,
  cliFlag,
  deleteReplayRun,
  parseSpeed,
  parseTime,
  recordedRange,
  runReplay,
} from "../lib/replay";

async function main() {
  const symbols = (cliArg("symbols") ?? "BTCUSDT,ETHUSDT").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const speed = parseSpeed(cliArg("speed"), 1);
  if (cliFlag("no-ai")) delete process.env.OPENROUTER_API_KEY;

  const range = await recordedRange(symbols);
  if (!range) {
    console.error(`No recorded events for ${symbols.join(", ")}. Run \`npm run record\` first.`);
    process.exitCode = 1;
    return;
  }
  const fromArg = cliArg("from");
  const toArg = cliArg("to");
  const from = fromArg ? parseTime(fromArg) : range.from;
  const to = toArg ? parseTime(toArg) : range.to;

  const alertCounts = new Map<string, number>();
  const stats = await runReplay({
    symbols,
    from,
    to,
    speed,
    log: (l) => console.log(l),
    onResult: (event, result, symbol) => {
      if (result.alertTypes.length === 0) return;
      for (const t of result.alertTypes) alertCounts.set(`${symbol} ${t}`, (alertCounts.get(`${symbol} ${t}`) ?? 0) + 1);
    },
  });

  const saved = await prisma.alert.groupBy({
    by: ["alertType", "verdict"],
    where: { orderEvent: { symbol: { startsWith: stats.prefix } } },
    _count: { _all: true },
  });

  console.log("\nReplay finished");
  console.log(`  events evaluated   ${stats.evaluated} (engine errors ${stats.engineErrors})`);
  console.log(`  verdicts           ${JSON.stringify(stats.verdicts)}`);
  console.log(`  wall time          ${(stats.wallMs / 1000).toFixed(1)}s, effective speed ${stats.effectiveSpeed?.toFixed(2) ?? "n/a"}x${stats.speed ? `, max lag ${stats.maxLagMs}ms` : ""}`);
  console.log("  events with a firing rule:");
  for (const [k, v] of Array.from(alertCounts).sort()) console.log(`    ${k.padEnd(28)} ${v}`);
  console.log("  saved alerts (after 30s dedupe):");
  for (const g of saved) console.log(`    ${g.alertType.padEnd(16)} ${g.verdict.padEnd(7)} ${g._count._all}`);

  if (cliFlag("keep")) {
    console.log(`\nKept replay data under symbol prefix ${stats.prefix}`);
  } else {
    const removed = await deleteReplayRun(stats.prefix);
    console.log(`\nCleaned up ${removed.events} replay events and ${removed.alerts} alerts`);
  }
}

main()
  .catch((err) => {
    console.error("replay failed:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
