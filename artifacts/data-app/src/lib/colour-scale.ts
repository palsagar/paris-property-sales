import { interpolateMagma } from "d3-scale-chromatic";

export const COLOUR_STEPS = 9;

export interface StepScale {
  color(v: number): string;
  index(v: number): number;
  thresholds: number[];
  colors: string[];
}

/**
 * Quantile thresholds where Paris and the Communes each carry half of the weight,
 * so the 20 Arrondissements are not squeezed into one or two steps.
 * Threshold i is the first value whose cumulative weight exceeds i / steps.
 * If one side is empty, the other side carries all the weight.
 */
export function quantileThresholds(paris: number[], communes: number[], steps = COLOUR_STEPS): number[] {
  const bothSides = paris.length > 0 && communes.length > 0;
  const share = bothSides ? 0.5 : 1;
  const items = [
    ...paris.map((v) => ({ v, w: share / paris.length })),
    ...communes.map((v) => ({ v, w: share / communes.length })),
  ].sort((a, b) => a.v - b.v);
  const out: number[] = [];
  let cumulative = 0;
  let i = 1;
  for (const { v, w } of items) {
    cumulative += w;
    // The small margin absorbs rounding error in the sum of weights.
    while (i < steps && cumulative > i / steps + 1e-9) {
      if (out[out.length - 1] !== v) out.push(v);
      i++;
    }
  }
  return out;
}

export function makeStepScale(thresholds: number[]): StepScale {
  const n = thresholds.length + 1;
  const colors = Array.from({ length: n }, (_, i) => interpolateMagma(0.93 - 0.78 * (n === 1 ? 0.5 : i / (n - 1))));
  // A value equal to a threshold takes the higher step.
  const index = (v: number) => thresholds.filter((t) => v >= t).length;
  return { color: (v) => colors[index(v)], index, thresholds, colors };
}
