import { test } from "node:test";
import assert from "node:assert/strict";
import { eur, houseShareLabel, houseShareWarning, longMonthLabel, orTooFew, sqmOrTooFew } from "./fmt";

test("longMonthLabel spells out the month", () => {
  assert.equal(longMonthLabel("2026-06"), "June 2026");
  assert.equal(longMonthLabel("2022-01-03"), "January 2022");
});

test("a missing median reads Too few sales and never 0 EUR/m²", () => {
  assert.equal(sqmOrTooFew(null), "Too few sales");
  assert.equal(sqmOrTooFew(undefined), "Too few sales");
  assert.equal(sqmOrTooFew(10200), "10 200 EUR/m²");
});

test("the House share warning starts strictly above 10%", () => {
  assert.equal(houseShareWarning(10), null);
  assert.equal(houseShareWarning(null), null);
  assert.match(houseShareWarning(10.1) ?? "", /^Houses are 10% of these sales\./);
});

test("houseShareLabel rounds the share", () => {
  assert.equal(houseShareLabel(30.4), "30% houses");
  assert.equal(houseShareLabel(null), null);
});

test("orTooFew formats a value and shows the text for a null, never zero", () => {
  assert.equal(orTooFew(1000, eur), "1 000 EUR");
  assert.equal(orTooFew(0, eur), "0 EUR");
  assert.equal(orTooFew(null, eur), "Too few sales");
  assert.equal(orTooFew(undefined, eur), "Too few sales");
});
