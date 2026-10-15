// Clock read by the surveillance engine for its time-based throttles (alert
// dedupe, dual-brain throttle) and for alert timestamps. It is wall time
// unless a replay installs a simulated clock that follows event time, which
// keeps the 30s / 60s logic correct at any replay speed.

const wallClock = () => Date.now();
let source: () => number = wallClock;

export function now(): number {
  return source();
}

export function setClock(fn: () => number) {
  source = fn;
}

export function resetClock() {
  source = wallClock;
}
