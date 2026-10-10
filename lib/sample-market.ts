// Static sample data for the marketing page. A later phase swaps this for the
// live feed; shapes match what the terminal components expect.

export const SAMPLE_SYMBOL = "SMPL";

export type Level = { price: number; size: number };

// Hero ladder: five levels each side around a 0.02 spread.
export const heroAsks: Level[] = [
  { price: 101.3, size: 1900 },
  { price: 101.29, size: 2400 },
  { price: 101.28, size: 1600 },
  { price: 101.27, size: 3100 },
  { price: 101.26, size: 2200 },
];

export const heroBids: Level[] = [
  { price: 101.24, size: 2100 },
  { price: 101.23, size: 2800 },
  { price: 101.22, size: 1700 },
  { price: 101.21, size: 3300 },
  { price: 101.2, size: 2500 },
];

export const SPOOF_SIZE = 48000;
export const SPOOF_REST_SECONDS = 1.84;

// Terminal depth: eight levels each side.
export const depthAsks: Level[] = [
  { price: 101.33, size: 4100 },
  { price: 101.32, size: 2600 },
  { price: 101.31, size: 5200 },
  { price: 101.3, size: 1900 },
  { price: 101.29, size: 2400 },
  { price: 101.28, size: 1600 },
  { price: 101.27, size: 3100 },
  { price: 101.26, size: 2200 },
];

export const depthBids: Level[] = [
  { price: 101.24, size: 2100 },
  { price: 101.23, size: 2800 },
  { price: 101.22, size: 1700 },
  { price: 101.21, size: 3300 },
  { price: 101.2, size: 2500 },
  { price: 101.19, size: 4600 },
  { price: 101.18, size: 3900 },
  { price: 101.17, size: 2200 },
];

export type Candle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// Deterministic so server and client render identical markup.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildCandles(count: number): Candle[] {
  const rand = mulberry32(20261010);
  const out: Candle[] = [];
  let last = 101.02;
  for (let i = 0; i < count; i++) {
    // Gentle upward drift, with a push toward the spoof bid near the end
    // followed by a reversion once the order is pulled.
    const drift = i > 50 && i < 55 ? 0.012 : i >= 55 && i < 58 ? -0.01 : 0.0035;
    const open = last;
    const close = open + drift + (rand() - 0.5) * 0.03;
    const high = Math.max(open, close) + rand() * 0.015;
    const low = Math.min(open, close) - rand() * 0.015;
    const volume = 800 + rand() * 2200 + (i > 50 && i < 58 ? 2600 : 0);
    out.push({ open, high, low, close, volume });
    last = close;
  }
  // Anchor the session so the last trade sits inside the sample spread.
  const shift = LAST_PRICE - out[out.length - 1].close;
  return out.map((c) => ({
    ...c,
    open: c.open + shift,
    high: c.high + shift,
    low: c.low + shift,
    close: c.close + shift,
  }));
}

export const LAST_PRICE = 101.25;
export const candles: Candle[] = buildCandles(64);
export const sessionChange = LAST_PRICE - candles[0].open;

export const timeTicks = ["14:00", "14:08", "14:16", "14:24", "14:32"];
