import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStepScale, quantileThresholds } from "./colour-scale";

test("each side of the city limit carries half of the weight", () => {
  // Weights: Paris 0.25 each, Communes 0.125 each. Cumulative: 1=.125, 2=.25, 3=.375, 4=.5, 10=.75, 20=1.
  // Each threshold is the first value whose cumulative weight exceeds i / 4, so each step holds a quarter.
  assert.deepEqual(quantileThresholds([10, 20], [1, 2, 3, 4], 4), [3, 10, 20]);
});

test("a value on a threshold takes the higher step", () => {
  const s = makeStepScale([2, 4, 10]);
  assert.deepEqual([1, 2, 3, 4, 10, 99].map(s.index), [0, 1, 1, 2, 3, 3]);
  assert.equal(s.colors.length, 4);
});

test("both sides keep several steps with invented spreads like the real ones", () => {
  const paris = Array.from({ length: 20 }, (_, i) => 8500 + i * 325);
  const communes = Array.from({ length: 135 }, (_, i) => 2200 + i * 65);
  const s = makeStepScale(quantileThresholds(paris, communes));
  const used = (v: number[]) => new Set(v.map(s.index)).size;
  assert.ok(used(paris) >= 4);
  assert.ok(used(communes) >= 6);
});

test("an empty side, an empty scale and equal values all work", () => {
  assert.deepEqual(quantileThresholds([], [1, 2, 3, 4], 4), [2, 3, 4]);
  assert.deepEqual(quantileThresholds([], [], 4), []);
  assert.deepEqual(quantileThresholds([5, 5], [5, 5], 4), [5]);
  assert.equal(makeStepScale([]).colors.length, 1);
});

test("every dark-mode step keeps 3:1 against the dark card", () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  // The dark --card token, hsl(224 28% 11%).
  const card = lum("#141824");
  for (const c of makeStepScale([1, 2, 3, 4, 5, 6, 7, 8], true).colors) assert.ok((lum(c) + 0.05) / (card + 0.05) >= 3, c);
});
