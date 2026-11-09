import { test } from "node:test";
import assert from "node:assert/strict";
import { csvSafe, escapeHtml } from "./escape";

test("escapeHtml neutralises markup and quotes", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&#60;img src=x onerror=&#34;a(&#39;b&#39;)&#34;&#62;&#38;");
});

test("escapeHtml leaves plain names alone", () => {
  assert.equal(escapeHtml("Rue de l'Église"), "Rue de l&#39;Église");
  assert.equal(escapeHtml("Saint-Denis"), "Saint-Denis");
});

test("csvSafe stops a spreadsheet from reading a text cell as a formula", () => {
  const rows = csvSafe([
    { street: "=HYPERLINK(\"http://x\")", a: "+1+1", b: "-2+3", c: "@SUM(A1)", d: "\tTAB", e: "\rCR" },
  ]);
  assert.deepEqual(rows, [
    { street: "'=HYPERLINK(\"http://x\")", a: "'+1+1", b: "'-2+3", c: "'@SUM(A1)", d: "'\tTAB", e: "'\rCR" },
  ]);
});

test("csvSafe keeps numbers, numeric text and plain text as they are", () => {
  const row = { change: -4.2, price: 350000, text: "-12.5", plus: "+3", name: "Saint-Denis", empty: "", none: null };
  assert.deepEqual(csvSafe([row]), [row]);
});
