import { test } from "node:test";
import assert from "node:assert/strict";
import { browserLanguages, pickLang, plural, setLang } from "./language";

test("a saved choice wins over the browser language", () => {
  assert.equal(pickLang("fr", ["en-GB"]), "fr");
  assert.equal(pickLang("en", ["fr-FR"]), "en");
});

test("without a saved choice, the browser's first language decides", () => {
  assert.equal(pickLang(null, ["fr-FR", "en"]), "fr");
  assert.equal(pickLang(null, ["FR"]), "fr");
  assert.equal(pickLang(null, ["en-US", "fr"]), "en");
  assert.equal(pickLang(null, []), "en");
  assert.equal(pickLang("de", ["de-DE"]), "en");
});

test("an empty languages list falls back to the browser's language", () => {
  assert.deepEqual(browserLanguages([], "fr-FR"), ["fr-FR"]);
  assert.deepEqual(browserLanguages(undefined, "fr-FR"), ["fr-FR"]);
  assert.deepEqual(browserLanguages(["en-GB", "fr"], "fr-FR"), ["en-GB", "fr"]);
});

test("plural follows the language's rules", () => {
  setLang("fr");
  assert.equal(plural(0, "vente", "ventes"), "vente");
  assert.equal(plural(2, "vente", "ventes"), "ventes");
  setLang("en");
  assert.equal(plural(0, "sale", "sales"), "sales");
});
