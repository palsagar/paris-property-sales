import { test } from "node:test";
import assert from "node:assert/strict";
import { binStart, binTick, binTicks, niceTicks } from "./histogram";

const bins = [0, 250, 500, 750, 1000, 1250, 1500].map((from) => ({ from, to: from + 250 }));

test("binStart gives the start of the bin that holds the value", () => {
  assert.equal(binStart(bins, 0), 0);
  assert.equal(binStart(bins, 499), 250);
  assert.equal(binStart(bins, 500), 500);
});

test("binStart falls on the last bin for a value past the end", () => {
  assert.equal(binStart(bins, 99999), 1500);
  assert.equal(binStart([], 5), undefined);
});

test("binTicks labels evenly spaced bin starts", () => {
  const price = Array.from({ length: 31 }, (_, i) => ({ from: i * 50000, to: (i + 1) * 50000 }));
  assert.deepEqual(binTicks(price), { ticks: [0, 500000, 1000000, 1500000], step: 500000 });
  const sqm = Array.from({ length: 42 }, (_, i) => ({ from: 1000 + i * 500, to: 1500 + i * 500 }));
  assert.deepEqual(binTicks(sqm).ticks, [5000, 10000, 15000, 20000]);
  assert.deepEqual(binTicks(bins).ticks, [0, 500, 1000, 1500]);
});

test("binTick shows the decimals its step needs, so labels do not repeat", () => {
  assert.equal(binTick(1500, 500), "1.5k");
  assert.equal(binTick(1250, 250), "1.25k");
  assert.equal(binTick(10000, 5000), "10k");
  assert.equal(binTick(500000, 500000), "500k");
  assert.equal(binTick(1500000, 500000), "1.5M");
  assert.equal(binTick(2000000, 1000000), "2M");
});

test("niceTicks are round and evenly spaced", () => {
  assert.deepEqual(niceTicks(8400, 14600), [8000, 10000, 12000, 14000, 16000]);
  assert.deepEqual(niceTicks(3900, 14500), [0, 5000, 10000, 15000]);
});
