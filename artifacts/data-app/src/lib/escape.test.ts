import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml } from "./escape";

test("escapeHtml neutralises markup and quotes", () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&#60;img src=x onerror=&#34;a(&#39;b&#39;)&#34;&#62;&#38;");
});

test("escapeHtml leaves plain names alone", () => {
  assert.equal(escapeHtml("Rue de l'Église"), "Rue de l&#39;Église");
  assert.equal(escapeHtml("Saint-Denis"), "Saint-Denis");
});
