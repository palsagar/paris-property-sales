import { test } from "node:test";
import assert from "node:assert/strict";
import type { SalePoint } from "@workspace/api-client-react";
import { dotTooltip, groupDots } from "./dots";

let n = 0;
function sale(p: Partial<SalePoint> = {}): SalePoint {
  n++;
  return {
    id: `s${n}`, lon: 2.341, lat: 48.861, price: 100000, surface: 10, pricePerSqm: 10000,
    arrondissement: 1, commune: null, quartier: "7510101", areaName: "1er arrondissement",
    date: "2024-01-10", type: "Appartement", address: "Rue A", ...p,
  };
}

test("Sales at one position and Area share a dot, newest first", () => {
  const sales = [sale({ date: "2024-03-01" }), sale({ date: "2024-02-01" }), sale({ date: "2024-01-01" })];
  const dots = groupDots(sales, "arr");
  assert.equal(dots.length, 1);
  assert.deepEqual(dots[0]!.sales.map((s) => s.id), sales.map((s) => s.id));
  assert.deepEqual(dots[0]!.area, { kind: "arr", arr: 1 });
});

test("one position in two Areas gives two dots", () => {
  const dots = groupDots([sale({ arrondissement: 1 }), sale({ arrondissement: 2, quartier: "7510201" })], "arr");
  assert.equal(dots.length, 2);
  assert.deepEqual(dots.map((d) => d.area), [{ kind: "arr", arr: 1 }, { kind: "arr", arr: 2 }]);
  assert.notEqual(dots[0]!.key, dots[1]!.key);
});

test("the radius grows with the Sales and stops at 9", () => {
  const radius = (k: number) => groupDots(Array.from({ length: k }, () => sale()), "arr")[0]!.radius;
  assert.equal(radius(1), 3);
  assert.equal(radius(5), 5);
  assert.equal(radius(400), 9);
});

test("the colour value is the median", () => {
  const median = (v: number[]) => groupDots(v.map((x) => sale({ pricePerSqm: x })), "arr")[0]!.medianPricePerSqm;
  assert.equal(median([1000, 2000, 9000]), 2000);
  assert.equal(median([1000, 3000]), 2000);
});

test("the nudge is fixed and stays inside the cell", () => {
  const p = { lat: 48.861, lon: 2.341 };
  const [a] = groupDots([sale(p)], "arr");
  const [b] = groupDots([sale(p)], "arr");
  assert.deepEqual([a!.lat, a!.lon], [b!.lat, b!.lon]);
  assert.ok(Math.abs(a!.lat - p.lat) < 0.0005);
  assert.ok(Math.abs(a!.lon - p.lon) < 0.0005);
});

test("the nudge breaks a regular block of positions", () => {
  const sales: SalePoint[] = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) sales.push(sale({ lat: 48.85 + i * 0.001, lon: 2.33 + j * 0.001 }));
  const dots = groupDots(sales, "arr");
  const offsets = (f: (d: (typeof dots)[number], s: SalePoint) => number) => new Set(dots.map((d) => f(d, d.sales[0]!).toFixed(7))).size;
  assert.equal(dots.length, 100);
  assert.ok(offsets((d, s) => d.lat - s.lat) >= 90);
  assert.ok(offsets((d, s) => d.lon - s.lon) >= 90);
  for (const d of dots) assert.ok(Math.abs(d.lat - d.sales[0]!.lat) < 0.0005 && Math.abs(d.lon - d.sales[0]!.lon) < 0.0005);
});

test("the nudge depends only on the position and Area", () => {
  const [a] = groupDots([sale({ price: 1, date: "2022-01-01", id: "x" })], "arr");
  const [b] = groupDots([sale({ price: 999999, date: "2025-01-01", id: "y" })], "arr");
  assert.deepEqual([a!.lat, a!.lon], [b!.lat, b!.lon]);
});

test("the tooltip lists up to 8 Sales and counts the rest", () => {
  const [d] = groupDots(Array.from({ length: 37 }, () => sale()), "arr");
  const html = dotTooltip(d!, "1er arrondissement");
  assert.match(html, /37 sales near here/);
  assert.equal(html.match(/class="pt-row"/g)?.length, 8);
  assert.match(html, /and 29 more sales/);
});

test("the tooltip escapes street names and states no median", () => {
  const [one] = groupDots([sale({ address: "<b>Rue</b>" })], "arr");
  const [many] = groupDots([sale({ address: "<b>Rue</b>" }), sale({ address: "<b>Rue</b>" })], "arr");
  for (const html of [dotTooltip(one!, "1er"), dotTooltip(many!, "1er")]) {
    assert.ok(!html.includes("<b>Rue"));
    assert.ok(html.includes("&#60;b&#62;Rue"));
    assert.ok(!/median/i.test(html));
  }
});

test("the tooltip escapes the date", () => {
  const [one] = groupDots([sale({ date: "<i>2024</i>" })], "arr");
  const [many] = groupDots([sale({ date: "<i>2024</i>" }), sale({ date: "<i>2024</i>" })], "arr");
  for (const html of [dotTooltip(one!, "1er"), dotTooltip(many!, "1er")]) assert.ok(!html.includes("<i>"), html);
});

test("a single Sale keeps today's tooltip", () => {
  const [d] = groupDots([sale({ address: "Rue A", surface: 40, price: 400000, pricePerSqm: 10000, date: "2024-03-05" })], "arr");
  assert.equal(dotTooltip(d!, "2e arrondissement"),
    `<div class="pt-title">Rue A</div><div class="pt-sub">2e arrondissement</div><div>Apartment of 40 m², sold on 2024-03-05</div><div class="pt-num">400 000 EUR, <b>10 000 EUR/m²</b></div>`);
});

test("a stacked dot's rows sit in a block that wraps, so the tooltip fits a phone's map", () => {
  const [d] = groupDots([sale(), sale()], "arr");
  assert.match(dotTooltip(d!, "1er"), /<div class="pt-rows">(<div class="pt-row">.*?<\/div>){2}<\/div>/);
});

test("a dot's tooltip is French after a switch, and an apostrophe stays plain text", async () => {
  const { setLang } = await import("./i18n/language");
  const sale = (i: number) => ({ id: String(i), lat: 48.85, lon: 2.35, price: 400000, pricePerSqm: 10000, surface: 40, type: "Appartement", date: "2024-03-05", address: "Rue de l'Église", arrondissement: 2, areaName: "2e arrondissement", quartier: null, commune: null } as unknown as SalePoint);
  setLang("fr");
  try {
    const [one] = groupDots([sale(1)], "arr");
    const [many] = groupDots([sale(1), sale(2), sale(3)], "arr");
    assert.match(dotTooltip(one!, "2e arrondissement"), /Appartement de 40 m², vendu le 2024-03-05/);
    assert.match(dotTooltip(many!, "2e arrondissement"), /3 ventes près d'ici/);
    assert.match(dotTooltip(many!, "2e arrondissement"), /Rue de l&#39;Église, appartement de 40 m²/);
  } finally {
    setLang("en");
  }
});
