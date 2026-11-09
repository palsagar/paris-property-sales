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

test("inArea reads after the word in", async () => {
  const { inArea } = await import("./fmt");
  assert.equal(inArea("11e arrondissement"), "the 11e arrondissement");
  assert.equal(inArea("All Paris"), "all of Paris");
  assert.equal(inArea("Montreuil"), "Montreuil");
});

test("keep joins a figure to its unit", async () => {
  const { keep } = await import("./fmt");
  assert.equal(keep("12 054 sales"), "12\u00a0054 sales");
  assert.equal(keep("between 9 070 EUR/m² and 573 k EUR."), "between 9\u00a0070\u00a0EUR/m² and 573\u00a0k\u00a0EUR.");
});

test("labels built on the client match the server's English labels", async () => {
  const { yearRangeLabel, bucketLabel } = await import("./fmt");
  const { setLang } = await import("./i18n/language");
  setLang("en");
  assert.equal(yearRangeLabel("2021-07-01", "2021-12-31"), "2021, Jul–Dec");
  assert.equal(yearRangeLabel("2024-01-01", "2024-12-31"), "2024");
  assert.equal(yearRangeLabel("2026-01-01", "2026-01-31"), "2026, Jan");
  assert.equal(bucketLabel("2024-04-01", "quarter"), "2024 Q2");
  assert.equal(bucketLabel("2024-03-01", "month"), "2024-03");
  assert.equal(bucketLabel("2024-01-01", "year"), "2024");
});

test("dates and labels in French", async () => {
  const { yearRangeLabel, bucketLabel, monthLabel, longMonthLabel, dateLabel, tooFew } = await import("./fmt");
  const { setLang } = await import("./i18n/language");
  setLang("fr");
  try {
    assert.equal(yearRangeLabel("2021-07-01", "2021-12-31"), "2021, juil.–déc.");
    assert.equal(bucketLabel("2024-04-01", "quarter"), "T2 2024");
    assert.equal(monthLabel("2024-02"), "févr. 2024");
    assert.equal(longMonthLabel("2026-08"), "août 2026");
    assert.equal(dateLabel("2024-03-05"), "5 mars 2024");
    assert.equal(tooFew(), "Trop peu de ventes");
  } finally {
    setLang("en");
  }
});

test("both languages group thousands with a space; decimals and percent signs follow the language", async () => {
  const { pct, arrLabel, eurShort, kShort, sharePct } = await import("./fmt");
  const { setLang } = await import("./i18n/language");
  for (const l of ["en", "fr"] as const) {
    setLang(l);
    assert.equal(eur(12054), "12 054 EUR");
    assert.equal(arrLabel(1), "1er");
  }
  setLang("en");
  assert.deepEqual([pct(3.44), pct(-9.5), pct(-0.04), pct(12, 0)], ["+3.4%", "\u22129.5%", "0.0%", "+12%"]);
  assert.deepEqual([eurShort(84.55e9), eurShort(1.2e6), kShort(3500, 1)], ["84.55 Md EUR", "1.2 M EUR", "3.5k"]);
  setLang("fr");
  try {
    assert.deepEqual([pct(3.44), pct(-9.5), pct(0, 0)], ["+3,4\u202f%", "\u22129,5\u202f%", "0\u202f%"]);
    assert.deepEqual([eurShort(84.55e9), eurShort(1.2e6), kShort(3500, 1), sharePct(0.44)], ["84,55 Md EUR", "1,2 M EUR", "3,5k", "moins de 1\u202f%"]);
  } finally {
    setLang("en");
  }
});

test("a small share of houses above zero never reads 0%", async () => {
  const { sharePct } = await import("./fmt");
  assert.deepEqual([sharePct(0), sharePct(0.44), sharePct(0.6), sharePct(30.4)], ["0%", "under 1%", "1%", "30%"]);
  assert.equal(houseShareLabel(0.44), "under 1% houses");
});

test("in French, a Quartier reads 'dans le quartier', a Commune 'à'", async () => {
  const { inArea } = await import("./fmt");
  const { setLang } = await import("./i18n/language");
  setLang("fr");
  try {
    assert.equal(inArea("Halles", "q"), "dans le quartier Halles");
    assert.equal(inArea("Montreuil", "commune"), "à Montreuil");
    assert.equal(inArea("11e arrondissement", "arr"), "dans le 11e arrondissement");
  } finally {
    setLang("en");
  }
  assert.equal(inArea("Halles", "q"), "Halles");
});

test("in French, a Commune whose name starts with Le or Les reads 'au' or 'aux'", async () => {
  const { inArea } = await import("./fmt");
  const { setLang } = await import("./i18n/language");
  const { t } = await import("./i18n/messages");
  setLang("fr");
  try {
    assert.equal(inArea("Le Pré-Saint-Gervais", "commune"), "au Pré-Saint-Gervais");
    assert.equal(inArea("Le Kremlin-Bicêtre", "commune"), "au Kremlin-Bicêtre");
    assert.equal(inArea("Les Lilas", "commune"), "aux Lilas");
    assert.equal(inArea("La Garenne-Colombes", "commune"), "à La Garenne-Colombes");
    assert.equal(inArea("L'Haÿ-les-Roses", "commune"), "à L'Haÿ-les-Roses");
    assert.equal(
      t().trend.takeaway(inArea("Le Pré-Saint-Gervais", "commune"), "9 000 €/m²", 6, "8 000 €/m²", "+12 %"),
      "Au Pré-Saint-Gervais, la médiane était de 9 000 €/m² les 6 derniers mois de la période, contre 8 000 €/m² les 6 premiers\u00a0: +12 %.",
    );
  } finally {
    setLang("en");
  }
});
