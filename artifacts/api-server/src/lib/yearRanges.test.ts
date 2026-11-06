import assert from "node:assert/strict";
import test from "node:test";
import { yearRanges } from "./yearRanges";

test("Partial years carry their months and stay inside the data", () => {
  const y = yearRanges("2021-07-01", "2026-06-30");
  assert.deepEqual(y.map((r) => r.label), ["2021, Jul–Dec", "2022", "2023", "2024", "2025", "2026, Jan–Jun"]);
  assert.deepEqual(y[0], { label: "2021, Jul–Dec", from: "2021-07-01", to: "2021-12-31" });
  assert.deepEqual(y[1], { label: "2022", from: "2022-01-01", to: "2022-12-31" });
  assert.deepEqual(y[5], { label: "2026, Jan–Jun", from: "2026-01-01", to: "2026-06-30" });
});

test("a year with Sales in January and December is not Partial", () => {
  const y = yearRanges("2022-01-03", "2024-12-30");
  assert.deepEqual(y.map((r) => r.label), ["2022", "2023", "2024"]);
  assert.equal(y[0].from, "2022-01-03");
  assert.equal(y[2].to, "2024-12-30");
});

test("one year and one month", () => {
  assert.deepEqual(yearRanges("2026-02-10", "2026-06-30").map((r) => r.label), ["2026, Feb–Jun"]);
  assert.deepEqual(yearRanges("2026-03-02", "2026-03-20").map((r) => r.label), ["2026, Mar"]);
});
