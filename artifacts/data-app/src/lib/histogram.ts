import { fixed, num } from "./fmt";

type Bin = { from: number; to: number };

/** The `from` of the bin that holds the value. A value past the last bin falls on the last bin. */
export function binStart(bins: Bin[], v: number): number | undefined {
  return (bins.find((b) => v >= b.from && v < b.to) ?? bins[bins.length - 1])?.from;
}

/**
 * The bin starts that get an axis label: every multiple of one round step, so the labels are evenly spaced
 * (0, 500k, 1M, 1.5M). The step is a multiple of the bin width that leaves at most `max` labels.
 */
export function binTicks(bins: Bin[], max = 6): { ticks: number[]; step: number } {
  if (bins.length === 0) return { ticks: [], step: 1 };
  const width = bins[0]!.to - bins[0]!.from;
  const span = bins[bins.length - 1]!.to - bins[0]!.from;
  let step = width;
  for (const m of [1, 2, 4, 5, 10, 20, 40, 50, 100, 200]) {
    step = width * m;
    if (span / step <= max) break;
  }
  const ticks = bins.map((b) => b.from).filter((f) => Math.abs(f / step - Math.round(f / step)) < 1e-9);
  return { ticks, step };
}

/**
 * The axis label of a bin's start. It shows as many decimals as the label step needs, so that neighbouring labels
 * never repeat (with a step of 500, 1,500 reads "1.5k", not "2k").
 */
export function binTick(from: number, step: number): string {
  if (Math.abs(from) < 1000) return num(from);
  if (Math.abs(from) >= 1e6) return `${fixed(from / 1e6, step % 1e6 === 0 ? 0 : step % 1e5 === 0 ? 1 : 2)}M`;
  return `${fixed(from / 1e3, step % 1000 === 0 ? 0 : step % 100 === 0 ? 1 : 2)}k`;
}

/** Evenly spaced round ticks (steps of 1, 2 or 5 times a power of ten) that cover lo to hi with about `count` steps. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  const raw = Math.max(hi - lo, 1) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = ([1, 2, 5, 10].find((f) => f * magnitude >= raw) ?? 10) * magnitude;
  const start = Math.floor(lo / step) * step, end = Math.ceil(hi / step) * step;
  return Array.from({ length: Math.round((end - start) / step) + 1 }, (_, i) => start + i * step);
}
