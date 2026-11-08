import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { areaProps, openProps, track, trackPageview } from "./analytics";
import { parseView } from "./view-state";

type Call = unknown[];
const g = globalThis as { umami?: unknown; document?: unknown };
const tick = () => new Promise((r) => setTimeout(r, 5));
const stub = () => {
  const calls: Call[] = [];
  g.umami = { track: (...args: unknown[]) => { calls.push(args); } };
  return calls;
};

afterEach(() => { delete g.umami; delete g.document; });

test("track sends the event to Umami on a later task, not during the click", async () => {
  const calls = stub();
  track("sort-sales", { column: "price", dir: "asc" });
  assert.equal(calls.length, 0);
  await tick();
  assert.deepEqual(calls, [["sort-sales", { column: "price", dir: "asc" }]]);
});

test("an event without properties is sent by name alone", async () => {
  const calls = stub();
  track("print");
  await tick();
  assert.deepEqual(calls, [["print", undefined]]);
});

test("without Umami and without its script, track does nothing and throws nothing", async () => {
  assert.doesNotThrow(() => track("print"));
  g.document = { querySelector: () => null };
  assert.doesNotThrow(() => track("copy-link", { via: "clipboard" }));
  await tick();
});

test("an error inside Umami never reaches the page", async () => {
  g.umami = { track: () => { throw new Error("blocked"); } };
  track("print");
  await tick();
});

test("events made before the script loads wait for it and go out in order", async () => {
  const script = new EventTarget();
  g.document = { querySelector: (s: string) => (s === "script[data-website-id]" ? script : null) };
  track("toggle-band", { on: true });
  track("toggle-band", { on: false });
  await tick();
  const calls: Call[] = [];
  g.umami = { track: (...args: unknown[]) => { calls.push(args); } };
  script.dispatchEvent(new Event("load"));
  assert.deepEqual(calls, [["toggle-band", { on: true }], ["toggle-band", { on: false }]]);
});

test("at most 50 events wait for the script", async () => {
  const script = new EventTarget();
  g.document = { querySelector: () => script };
  for (let i = 1; i <= 60; i++) track("page-sales", { page: i });
  await tick();
  const calls = stub();
  script.dispatchEvent(new Event("load"));
  assert.equal(calls.length, 50);
  assert.deepEqual(calls[49], ["page-sales", { page: 50 }]);
});

test("the page view never carries the query string", async () => {
  const calls = stub();
  trackPageview();
  await tick();
  assert.equal(calls.length, 1);
  const build = calls[0]![0] as (p: Record<string, unknown>) => Record<string, unknown>;
  assert.deepEqual(build({ url: "/?arr=6&type=Maison", referrer: "https://example.fr/" }), { url: "/", referrer: "https://example.fr/" });
  assert.deepEqual(build({ url: "/" }), { url: "/" });
});

test("areaProps names each kind of Area and keeps a stable code", () => {
  const names = new Map([["7510602", "Odéon"], ["92012", "Boulogne-Billancourt"]]);
  assert.deepEqual(areaProps({ kind: "paris" }, names), { level: "paris", area: "Paris", code: "paris" });
  assert.deepEqual(areaProps({ kind: "arr", arr: 1 }, names), { level: "arrondissement", area: "Paris 1er", code: "1" });
  assert.deepEqual(areaProps({ kind: "arr", arr: 6 }, names), { level: "arrondissement", area: "Paris 6e", code: "6" });
  assert.deepEqual(areaProps({ kind: "q", id: "7510602" }, names), { level: "quartier", area: "Odéon", code: "7510602" });
  assert.deepEqual(areaProps({ kind: "commune", id: "92012" }, names), { level: "commune", area: "Boulogne-Billancourt", code: "92012" });
  assert.deepEqual(areaProps({ kind: "department", id: "93" }, names), { level: "department", area: "Seine-Saint-Denis", code: "93" });
});

test("an Area whose name has not loaded is named by its code", () => {
  assert.deepEqual(areaProps({ kind: "q", id: "7510602" }, new Map()), { level: "quartier", area: "7510602", code: "7510602" });
});

test("openProps describes the Selection of a link, with the Period as months", () => {
  const v = parseView("?q=7510602&type=Maison&from=2023-01-01&to=2023-12-31&map=dots");
  assert.deepEqual(openProps(v, new Map([["7510602", "Odéon"]])), {
    level: "quartier", area: "Odéon", code: "7510602", type: "house", from: "2023-01", to: "2023-12", map: "dots",
  });
  const all = openProps(parseView("?arr=6"), new Map());
  assert.equal(all.type, "all");
  assert.ok(!("from" in all) && !("to" in all));
});
