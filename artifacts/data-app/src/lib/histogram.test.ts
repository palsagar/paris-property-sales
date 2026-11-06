import { test } from "node:test";
import assert from "node:assert/strict";
import { binStart, binTick } from "./histogram";

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

test("binTick shows decimals when the step is under 1,000 so labels do not repeat", () => {
  const labels = bins.map((b) => binTick(b.from, bins));
  assert.equal(new Set(labels).size, labels.length);
  assert.equal(binTick(1250, bins), "1.3k");
  assert.equal(binTick(1500, bins), "1.5k");
});

test("binTick uses whole thousands for a step of 1,000 or more", () => {
  const wide = [{ from: 100000, to: 150000 }];
  assert.equal(binTick(100000, wide), "100k");
  assert.equal(binTick(2500000, wide), "2.5M");
});
