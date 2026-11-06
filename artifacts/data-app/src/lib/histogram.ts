type Bin = { from: number; to: number };

/** The `from` of the bin that holds the value. A value past the last bin falls on the last bin. */
export function binStart(bins: Bin[], v: number): number | undefined {
  return (bins.find((b) => v >= b.from && v < b.to) ?? bins[bins.length - 1])?.from;
}

/**
 * The axis label of a bin's start. It shows decimals when the bin step is under 1,000, so that
 * neighbouring labels never repeat (1,250 and 1,500 read "1.3k" and "1.5k", not "1k" and "2k").
 */
export function binTick(from: number, bins: Bin[]): string {
  const step = bins.length > 0 ? bins[0]!.to - bins[0]!.from : 1000;
  if (Math.abs(from) < 1000) return `${Math.round(from)}`;
  if (Math.abs(from) >= 1e6) return `${(from / 1e6).toFixed(1)}M`;
  const decimals = step >= 1000 ? 0 : step >= 100 ? 1 : 2;
  return `${(from / 1e3).toFixed(decimals)}k`;
}
