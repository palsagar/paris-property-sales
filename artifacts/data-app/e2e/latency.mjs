// Latency test for issue #5: every Selection change is drawn within 200 ms of main-thread work,
// on Chrome at a 2x CPU slowdown, with reduced motion. A change counts from the moment it is asked for: the click, the
// key, or the release of the time slider's handle. It needs the full data and a running server.
// Run: pnpm --filter @workspace/data-app run latency [section ...]   (BASE_URL defaults to http://localhost:3000)
// MOTION=1 runs without reduced motion, to measure the map's fly-to, which is outside the 200 ms.
// DIST=<folder of a dashboard build> serves that build in place of the server's, with the API still from BASE_URL.
// The analytics section replaces Umami with a stub that records each event; the other sections run without Umami.
import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DIST = process.env.DIST;
const MIME = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };
const LIMIT_MS = 200;
const only = process.argv.slice(2);
const results = [];
let failed = false;

// The dates of the latest DVF release, so the test does not depend on one release.
const { datasetFrom, datasetTo, years } = await (await fetch(`${BASE}/api/sales/summary?propertyType=all`)).json();

const browser = await chromium.launch({ channel: "chrome", headless: true });

/** One page with the counters the checks read: API requests in flight, cache misses, React commits, skeletons added. */
async function openPage(path = "/", { umami = false, viewport = { width: 1440, height: 900 }, locale = "en-GB" } = {}) {
  const ctx = await browser.newContext({ viewport, locale, reducedMotion: process.env.MOTION ? "no-preference" : "reduce" });
  const page = await ctx.newPage();
  await page.route(/arcgisonline|fonts\.(googleapis|gstatic)/, (r) => r.abort());
  if (DIST) {
    await page.route((u) => u.origin === new URL(BASE).origin && !u.pathname.startsWith("/api"), async (r) => {
      const u = new URL(r.request().url());
      const f = extname(u.pathname) ? u.pathname.slice(1) : "index.html";
      try { await r.fulfill({ body: await readFile(join(DIST, f)), contentType: MIME[extname(f)] ?? "application/octet-stream" }); } catch { await r.abort(); }
    });
  }
  await page.addInitScript(() => {
    window.__commits = 0;
    window.__blanks = 0;
    window.__countBlanks = false;
    window.__longTasks = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__longTasks.push(e.duration); }).observe({ type: "longtask", buffered: false });
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, isDisabled: false, renderers: new Map(), inject: () => 1, checkDCE() {},
      onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {},
      onCommitFiberRoot() { window.__commits++; },
    };
    const isBlank = (n) => n.nodeType === 1 && (n.matches(".animate-pulse") || n.querySelector(".animate-pulse")) && n.closest('[data-testid^="card-"]');
    new MutationObserver((list) => {
      if (!window.__countBlanks) return;
      for (const m of list) for (const n of m.addedNodes) if (isBlank(n)) window.__blanks++;
    }).observe(document, { childList: true, subtree: true });
  });
  if (umami) {
    await page.addInitScript(() => {
      window.__events = [];
      window.print = () => {};
      // The page view passes a function that builds its payload, as Umami's own script would call it.
      window.umami = { track: (a, b) => window.__events.push(typeof a === "function" ? ["pageview", a({ url: location.pathname + location.search })] : [a, b]) };
    });
  }
  const net = { inflight: 0, last: 0, requests: 0, misses: 0, urls: [] };
  const isApi = (r) => r.url().includes("/api/");
  page.on("request", (r) => { if (isApi(r)) { net.inflight++; net.requests++; net.urls.push(r.url().split("/api")[1]); net.last = Date.now(); } });
  page.on("response", (r) => { if (isApi(r.request()) && r.headers()["x-cache"] === "MISS") net.misses++; });
  const done = (r) => { if (isApi(r)) { net.inflight--; net.last = Date.now(); } };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-testid="card-kpi-0"]');
  return { ctx, page, net };
}

/** Waits until no API request is in flight and 700 ms have passed with none. */
async function settle(net) {
  while (net.inflight > 0 || Date.now() - net.last < 700) await new Promise((r) => setTimeout(r, 25));
}

/** Main-thread work of one action: the sum of RunTask durations on the busiest renderer main thread. */
async function measure(p, name, act, { limit = LIMIT_MS, check = true } = {}) {
  const { page, net } = p;
  await settle(net);
  Object.assign(net, { requests: 0, misses: 0, urls: [] });
  await page.evaluate(() => { window.__commits = 0; window.__blanks = 0; window.__longTasks = []; });
  await browser.startTracing(page, { categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "toplevel"] });
  await act();
  net.last = Date.now();
  await settle(net);
  const ev = JSON.parse((await browser.stopTracing()).toString()).traceEvents;
  let best = { work: 0, tasks: [] };
  for (const t of ev.filter((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain")) {
    const tasks = ev.filter((e) => e.pid === t.pid && e.tid === t.tid && e.ph === "X" && e.name === "RunTask");
    const work = tasks.reduce((a, e) => a + e.dur, 0) / 1000;
    if (work >= best.work) best = { work, tasks };
  }
  const { commits, blanks, longTasks } = await page.evaluate(() => ({ commits: window.__commits, blanks: window.__blanks, longTasks: window.__longTasks }));
  const r = {
    name, workMs: Math.round(best.work), longestTaskMs: Math.round(Math.max(0, ...best.tasks.map((e) => e.dur)) / 1000),
    requests: net.requests, misses: net.misses, commits, blanks,
    // A second view of the same work from the page itself, to cross-check the trace on very long tasks.
    longTaskSumMs: Math.round(longTasks.reduce((a, d) => a + d, 0)),
  };
  r.pass = !check || (r.workMs <= limit && r.blanks === 0);
  if (!r.pass) failed = true;
  console.log(JSON.stringify(r));
  results.push(r);
  return r;
}

/**
 * The Area tiles and the Period controls live in the Selection bar's pickers (selection-bar.tsx), which open from the
 * "button-area" and "button-period" field buttons. `reveal` opens the picker that holds a control. Call it before a
 * measure, so that only the click itself is timed; `click` calls it too, for clicks outside a measure.
 */
const IN_PICKER = [[/^filter-(arr|dept)-|^input-area-search$/, "button-area"], [/^preset-|^select-(from|to)$|^time-control$|^text-range$/, "button-period"]];
async function reveal(page, id) {
  const el = page.locator(`[data-testid="${id}"]`).first();
  if (await el.isVisible().catch(() => false)) return;
  const opener = IN_PICKER.find(([re]) => re.test(id))?.[1];
  if (!opener) return;
  await page.click(`[data-testid="${opener}"]`);
  await el.waitFor({ state: "visible" });
}
const click = async (page, id) => { await reveal(page, id); await page.click(`[data-testid="${id}"]`); };

/**
 * The English words left on a French page, inside the element with the given test id, or in the whole body for "body".
 * It reads the visible text and every aria-label, title and placeholder.
 */
const ENGLISH = /\b(the|and|of|sales?|homes?|houses?|apartments?|price|median|period|area|too few|download|share|print|copy|link|light mode|dark mode|rooms?|quarter|data to|release|all paris)\b/i;
async function frenchSweep(page, scope) {
  return page.evaluate(([scope, src]) => {
    const re = new RegExp(src, "i");
    const roots = scope === "body" ? [document.body] : [...document.querySelectorAll(`[data-testid="${scope}"]`)];
    const found = roots.length ? [] : [`no element ${scope}`];
    for (const root of roots) {
      for (const line of (root.innerText ?? "").split("\n")) if (re.test(line)) found.push(line.trim());
      for (const el of [root, ...root.querySelectorAll("[aria-label],[title],[placeholder]")]) {
        for (const a of ["aria-label", "title", "placeholder"]) { const v = el.getAttribute(a); if (v && re.test(v)) found.push(`${a}="${v}"`); }
      }
    }
    return [...new Set(found)];
  }, [scope, ENGLISH.source]);
}

/** Opens the Area picker and types a name. Only the Enter that follows belongs in a measure. */
async function search(p, text) {
  await reveal(p.page, "input-area-search");
  await p.page.fill('[data-testid="input-area-search"]', text);
  await p.page.waitForTimeout(250);
}

async function backToParis(p) {
  await click(p.page, "filter-arr-all");
  await settle(p.net);
}

/** A random month-aligned Period inside the release's dates that is neither a calendar year nor the last 12 months. */
function randomPeriod() {
  const [firstY, firstM] = datasetFrom.split("-").map(Number), [lastY, lastM] = datasetTo.split("-").map(Number);
  const months = (lastY - firstY) * 12 + lastM - firstM + 1;
  const month = (i) => { const y = firstY + Math.floor((firstM - 1 + i) / 12), m = ((firstM - 1 + i) % 12) + 1; return [y, m]; };
  for (;;) {
    const len = 3 + Math.floor(Math.random() * 28);
    const start = Math.floor(Math.random() * (months - len + 1));
    const [y0, m0] = month(start), [y1, m1] = month(start + len - 1);
    if (len === 12 && (m0 === 1 || start + len === months)) continue;
    const last = new Date(Date.UTC(y1, m1, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, "0");
    return { from: `${y0}-${pad(m0)}-01`, to: `${y1}-${pad(m1)}-${pad(last)}` };
  }
}

const sections = {
  /** The Selection changes, measured at a 2x CPU slowdown. */
  async steps() {
    const period = randomPeriod();
    console.log(JSON.stringify({ period }));
    const p = await openPage(`/?from=${period.from}&to=${period.to}`);
    const cdp = await p.ctx.newCDPSession(p.page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 2 });
    await settle(p.net);
    await p.page.evaluate(() => { window.__countBlanks = true; });

    const idle = await measure(p, "idle control", async () => {}, { limit: 5 });
    if (!idle.pass) console.log("The idle control did work, so the measure itself is wrong.");

    for (const t of ["Appartement", "Maison", "all"]) await measure(p, `property type ${t}`, () => click(p.page, `filter-type-${t}`));

    for (const n of [5, 9, 14]) {
      await reveal(p.page, `filter-arr-${n}`);
      await measure(p, `arrondissement ${n}`, () => click(p.page, `filter-arr-${n}`));
      await backToParis(p);
    }
    for (const name of ["Montparnasse", "Picpus", "Auteuil", "Versailles", "Nanterre", "Créteil", "Hauts-de-Seine", "Seine-Saint-Denis", "Val-de-Marne"]) {
      await search(p, name);
      await measure(p, `area ${name}`, () => p.page.keyboard.press("Enter"));
      await backToParis(p);
    }

    await measure(p, "map mode change", () => click(p.page, "map-mode-change"));
    await measure(p, "map mode level", () => click(p.page, "map-mode-level"));
    await measure(p, "map level quartier", () => click(p.page, "map-level-quartier"));
    await click(p.page, "map-level-arr");
    await settle(p.net);

    // Up to three full calendar years, with the button's test id built as in time-control.tsx.
    const fullYears = years.filter((y) => y.from.endsWith("-01-01") && y.to.endsWith("-12-31")).slice(0, 3);
    for (const { label } of fullYears) {
      await reveal(p.page, `preset-${label.replace(/\s/g, "-").toLowerCase()}`);
      await measure(p, `year button ${label}`, () => click(p.page, `preset-${label.replace(/\s/g, "-").toLowerCase()}`));
    }

    await click(p.page, "preset-all-dates");
    await settle(p.net);
    await reveal(p.page, "time-control");
    for (const frac of [0.25, 0.5, 0.15]) {
      const handle = p.page.locator('[data-testid="time-control"] .recharts-brush-traveller').first();
      const box = await handle.boundingBox();
      const brush = await p.page.locator('[data-testid="time-control"] .recharts-brush').first().boundingBox();
      const y = box.y + box.height / 2;
      // The Selection changes when the mouse is released, so the 200 ms counts from the release.
      // The drag's own frames are recorded apart, outside the check, like the map's fly-to.
      await measure(p, `time slider drag frames to ${frac}`, async () => {
        await p.page.mouse.move(box.x + box.width / 2, y);
        await p.page.mouse.down();
        await p.page.mouse.move(brush.x + brush.width * frac, y, { steps: 8 });
      }, { check: false });
      await measure(p, `time slider release at ${frac}`, () => p.page.mouse.up());
    }
    await p.ctx.close();
  },

  /** The dot map: at most 5,000 Sales and the cap message. Measured, but outside the 200 ms check. */
  async dots() {
    for (const [label, path] of [["Paris, all dates", "/"], ["16th, all dates", "/?arr=16"], ["Versailles, all dates", "/?commune=78646"]]) {
      const p = await openPage(path);
      const cdp = await p.ctx.newCDPSession(p.page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 2 });
      await settle(p.net);
      let body = null, timing = null;
      p.page.on("response", async (r) => {
        if (!r.url().includes("/api/sales/points")) return;
        const buf = await r.body();
        body = { bytes: buf.length, json: JSON.parse(buf.toString()), cache: r.headers()["x-cache"] };
        timing = r.request().timing();
      });
      const m = await measure(p, `dots ${label}`, () => click(p.page, "map-mode-dots"), { check: false });
      const { total, items } = body.json;
      const cap = p.page.locator('[data-testid="text-dots-cap"]');
      const capShown = await cap.isVisible();
      const capText = capShown ? await cap.textContent() : "";
      const capTotal = Number((capText.match(/of ([\d\s,.\u202f\u00a0]+) sales/)?.[1] ?? "").replace(/\D/g, ""));
      const ok = items.length <= 5000 && (total > items.length ? capShown && capTotal === total : !capShown);
      if (!ok) failed = true;
      console.log(JSON.stringify({ name: `dots ${label} response`, bytes: body.bytes, cache: body.cache, serverMs: Math.round(timing.responseEnd - timing.requestStart), total, items: items.length, capShown, capTotal, pass: ok }));
      m.pass = ok;
      await p.ctx.close();
    }
  },

  /** The time slider applies a change when the drag or the key press ends, and never during a drag. No slowdown. */
  async slider() {
    const p = await openPage("/");
    const { page, net } = p;
    const handle = () => page.locator('[data-testid="time-control"] .recharts-brush-traveller').first();
    const brushBox = () => page.locator('[data-testid="time-control"] .recharts-brush').first().boundingBox();
    const range = () => page.textContent('[data-testid="text-range"]');
    const from = () => new URL(page.url()).searchParams.get("from");
    const centre = async () => { const b = await handle().boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };

    await settle(net);
    await reveal(page, "time-control");
    let [x, y] = await centre();
    let brush = await brushBox();
    const text0 = await range(), from0 = from();
    net.requests = 0;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(brush.x + brush.width * 0.3, y, { steps: 8 });
    await page.waitForTimeout(100);
    const textDuring = await range();
    await page.waitForTimeout(700);
    const requestsDuring = net.requests;
    await page.mouse.up();
    await page.waitForTimeout(300);
    check("slider: no request while the mouse is down", requestsDuring === 0, { requestsDuring });
    check("slider: the dates follow the drag", textDuring !== text0, { text0, textDuring });
    check("slider: the release applies the change", net.requests > 0 && from() !== from0, { requests: net.requests, from: from() });
    await settle(net);

    const from1 = from();
    await handle().focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(500);
    check("slider: an arrow key applies the change", from() !== from1, { before: from1, after: from() });
    await settle(net);
    const from1b = from();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(500);
    check("slider: a second arrow key, with no new click, applies again", from() !== from1b, { before: from1b, after: from() });
    await settle(net);

    [x, y] = await centre();
    const from2 = from();
    net.requests = 0;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(800);
    check("slider: a click with no movement requests nothing", net.requests === 0 && from() === from2, { requests: net.requests });
    await settle(net);

    [x, y] = await centre();
    brush = await brushBox();
    const from3 = from();
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(brush.x + brush.width * 0.1, y, { steps: 8 });
    await page.mouse.move(brush.x + brush.width * 0.1, y + 300, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    check("slider: a release outside the chart applies the change", from() !== from3, { before: from3, after: from() });
    await p.ctx.close();

    // A drag that is still held when the page swaps to an Area with a shorter timeline (Houses in the 8th).
    const q = await openPage("/");
    const errors = [];
    q.page.on("pageerror", (e) => errors.push(e.message));
    await click(q.page, "filter-type-Maison");
    await settle(q.net);
    await delay(q.page, /\/api\/sales\/by-rooms\?.*arrondissement=8/, 1500);
    const nameBefore = await q.page.textContent('[data-testid="text-area-name"]');
    await click(q.page, "filter-arr-8");
    await reveal(q.page, "time-control");
    const end = await q.page.locator('[data-testid="time-control"] .recharts-brush-traveller').nth(1).boundingBox();
    const box = await q.page.locator('[data-testid="time-control"] .recharts-brush').first().boundingBox();
    const ey = end.y + end.height / 2;
    await q.page.mouse.move(end.x + end.width / 2, ey);
    await q.page.mouse.down();
    await q.page.mouse.move(box.x + box.width * 0.9, ey, { steps: 4 });
    await q.page.waitForFunction((n) => document.querySelector('[data-testid="text-area-name"]')?.textContent !== n, nameBefore, { timeout: 8000 }).catch(() => {});
    await q.page.waitForTimeout(300);
    const state = async () => ({
      dashboard: await q.page.locator('[data-testid="card-kpi-0"]').isVisible(),
      dashboardError: await q.page.locator('[data-testid="dashboard-error"]').count(),
      crashed: await q.page.getByText("Something went wrong").count(),
      range: await q.page.locator('[data-testid="text-range"]').textContent().catch(() => null),
      errors: errors.length,
    });
    const fine = (s) => s.dashboard && !s.dashboardError && !s.crashed && !s.errors && !!s.range && !/undefined|Invalid/.test(s.range);
    const held = await state();
    check("slider: a drag held through the swap to a shorter timeline does not break the page", fine(held), held);
    await q.page.mouse.up();
    await q.page.waitForTimeout(500);
    const released = await state();
    const u = new URL(q.page.url()).searchParams;
    const valid = (d) => d === null || (/^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d)) && d >= datasetFrom && d <= datasetTo);
    const dates = { from: u.get("from"), to: u.get("to") };
    check("slider: its release after the swap applies only valid dates", fine(released) && valid(dates.from) && valid(dates.to), { ...released, ...dates });
    await q.ctx.close();
  },

  /** Every request of each Area's default view is in the server's warmed cache. Run it after the warm-up. */
  async warm() {
    for (const path of ["/", "/?arr=7", "/?q=7510501", "/?commune=78646", "/?dept=93"]) {
      const misses = [];
      let seen = 0;
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.route(/arcgisonline|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      page.on("response", (r) => {
        if (!r.url().includes("/api/")) return;
        seen++;
        if (r.headers()["x-cache"] !== "HIT") misses.push(r.url().split("/api")[1]);
      });
      await page.goto(BASE + path, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="card-kpi-0"]');
      await page.waitForTimeout(1000);
      check(`warm: every request of ${path} is a cache hit`, seen > 0 && misses.length === 0, { requests: seen, misses });
      await ctx.close();
    }
  },

  /** The page changes at once: the old Selection stays, correctly named, until all new data is in. No slowdown. */
  async behaviour() {
    // Together
    let p = await openPage("/");
    let { page, net } = p;
    await settle(net);
    await delay(page, /\/api\/sales\/by-rooms/, 1000);
    await watchHeading(page);
    const name0 = await page.textContent('[data-testid="text-area-name"]');
    const kpi0 = await page.textContent('[data-testid="text-kpi-0"]');
    const asked = Date.now();
    await click(page, "filter-arr-5");
    await page.waitForTimeout(300);
    const at300 = {
      // The Area tile sits in a picker that closes on a choice, so the Selection bar's Area button says what was asked.
      pressed: (await page.textContent('[data-testid="button-area"]'))?.includes("5e arrondissement") ? "true" : "false",
      updating: await page.locator('[data-testid="text-updating"]').isVisible().catch(() => false),
      heading: await page.textContent('[data-testid="text-area-name"]'),
      kpi: await page.textContent('[data-testid="text-kpi-0"]'),
      label: await page.locator('[data-testid="text-updating"]').boundingBox(),
      controls: [await page.locator('[data-testid="button-pdf"]').boundingBox(), await page.locator('[data-testid="button-theme"]').boundingBox()],
    };
    await settle(net);
    await page.waitForTimeout(200);
    const after = await page.evaluate(() => ({ names: window.__names, nameAt: window.__nameAt, kpiAt: window.__kpiAt }));
    check("together: the button moves at once", at300.pressed === "true", { pressed: at300.pressed });
    check("together: the page says it is updating", at300.updating === true);
    check("together: the old name and figures stay while loading", at300.heading === name0 && at300.kpi === kpi0);
    const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    check("together: the updating label covers no control", at300.label !== null && !at300.controls.some((c) => overlaps(at300.label, c)), { label: at300.label });
    const gap = after.nameAt.length && after.kpiAt.length ? Math.abs(after.nameAt.at(-1) - after.kpiAt.at(-1)) : null;
    check("together: the name and the figures change in one commit", gap !== null && gap <= 16, { gap, names: after.names.length });
    await p.ctx.close();

    // Rapid changes
    p = await openPage("/");
    ({ page, net } = p);
    await settle(net);
    await delay(page, /\/api\/sales\/by-rooms/, 1000);
    await watchHeading(page);
    await click(page, "filter-arr-5");
    await page.waitForTimeout(200);
    await click(page, "filter-arr-9");
    await settle(net);
    await page.waitForTimeout(200);
    const rapid = await page.evaluate(() => window.__names);
    check("rapid: the heading goes straight to the second Area", rapid.length === 2 && new URL(page.url()).searchParams.get("arr") === "9", { names: rapid.length });
    await p.ctx.close();

    // A second click on an Area while it loads
    p = await openPage("/");
    ({ page, net } = p);
    await settle(net);
    await delay(page, /\/api\/sales\/by-rooms/, 1000);
    await click(page, "filter-arr-5");
    await page.waitForTimeout(300);
    await click(page, "filter-arr-5");
    await settle(net);
    await page.waitForTimeout(200);
    const twice = { arr: new URL(page.url()).searchParams.get("arr"), heading: await page.textContent('[data-testid="text-area-name"]') };
    check("second click: a click on the Area that is loading keeps it", twice.arr === "5" && twice.heading !== "All Paris", twice);
    // Nothing is loading now, so a click on the selected Area clicks it off.
    await click(page, "filter-arr-5");
    await settle(net);
    await page.waitForTimeout(200);
    const off = { arr: new URL(page.url()).searchParams.get("arr"), heading: await page.textContent('[data-testid="text-area-name"]') };
    check("second click: with nothing loading, a click on the selected Area goes back to Paris", off.arr === null && off.heading === "All Paris", off);
    await p.ctx.close();

    // Failure of one panel
    p = await openPage("/");
    ({ page, net } = p);
    await settle(net);
    await page.route(/\/api\/sales\/by-rooms\?.*arrondissement=7/, (r) => r.abort());
    const nameBefore = await page.textContent('[data-testid="text-area-name"]');
    await click(page, "filter-arr-7");
    const switched = await page.waitForFunction((n) => document.querySelector('[data-testid="text-area-name"]').textContent !== n, nameBefore, { timeout: 5000 }).then(() => true, () => false);
    const roomsError = await page.locator('[data-testid="card-rooms"] [data-testid="button-retry"]').waitFor({ timeout: 20000 }).then(() => true, () => false);
    const kpiOk = await page.locator('[data-testid="card-kpi-0"] [data-testid="button-retry"]').count() === 0;
    check("failure: the page still switches", switched);
    check("failure: only the failed panel shows its error", roomsError && kpiOk, { roomsError, kpiOk });
    await p.ctx.close();

    // A request that never answers
    p = await openPage("/");
    ({ page, net } = p);
    await settle(net);
    await page.route(/\/api\/sales\/by-rooms\?.*arrondissement=7/, () => {});
    const nameHung = await page.textContent('[data-testid="text-area-name"]');
    await click(page, "filter-arr-7");
    const swapped = await page.waitForFunction((n) => document.querySelector('[data-testid="text-area-name"]').textContent !== n
      && !document.querySelector('[data-testid="text-updating"]'), nameHung, { timeout: 6000 }).then(() => true, () => false);
    const rooms = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="card-rooms"]');
      // The rooms panel is a table now: its rows are the figures that must not show another Area's numbers.
      return { skeleton: !!card.querySelector(".animate-pulse"), chart: !!card.querySelector(".recharts-wrapper, [data-testid=table-rooms]") };
    });
    check("hung request: the page switches within 6 s", swapped);
    check("hung request: the waiting panel shows no other Area's figures", swapped && !rooms.chart, rooms);
    await p.ctx.close();

    // Panel state at an Area change, and no late requests
    p = await openPage("/");
    ({ page, net } = p);
    await settle(net);
    await click(page, "sort-price");
    await settle(net);
    await click(page, "button-next");
    await settle(net);
    await click(page, "button-next");
    await settle(net);
    await page.evaluate(() => { window.__countBlanks = true; window.__blanks = 0; });
    await watchHeading(page);
    const startedAt = [];
    page.on("request", (r) => { if (r.url().includes("/api/")) startedAt.push(Date.now()); });
    await click(page, "filter-arr-6");
    await settle(net);
    const pageText = await page.textContent('[data-testid="text-page"]');
    const sortKept = await page.locator('[data-testid="sort-price"] svg').count() === 1;
    let st = await page.evaluate(() => ({ blanks: window.__blanks, nameAt: window.__nameAt }));
    check("panel state: no panel blanks at an Area change", st.blanks === 0, { blanks: st.blanks });
    check("panel state: the Sales list goes to its first page and keeps its sort", pageText.includes("page 1 of") && sortKept, { pageText, sortKept });
    await click(page, "filter-arr-all");
    await settle(net);
    const backText = await page.textContent('[data-testid="text-page"]');
    check("panel state: back on the first Area, the Sales list is on its first page", backText.includes("page 1 of"), { backText });
    await click(page, "filter-arr-6");
    await settle(net);
    const lateRequests = startedAt.filter((t) => st.nameAt.length && t > st.nameAt.at(-1) + 5).length;
    check("no late requests: no panel asks for data after the heading changed", st.nameAt.length > 0 && lateRequests === 0, { lateRequests });
    await click(page, "toggle-smooth");
    await settle(net);
    await page.evaluate(() => { window.__blanks = 0; });
    await click(page, "filter-arr-8");
    await settle(net);
    st = await page.evaluate(() => ({ blanks: window.__blanks }));
    check("panel state: no blank after Smoothing was switched by hand", st.blanks === 0, { blanks: st.blanks });
    await p.ctx.close();

    // The sticky Selection bar stays on top of the map when the map scrolls under it, on a desktop and on a phone.
    for (const [label, viewport] of [["1440 px", { width: 1440, height: 900 }], ["375 px", { width: 375, height: 812 }]]) {
      p = await openPage("/", { viewport });
      ({ page, net } = p);
      await settle(net);
      if (viewport.width < 768) { await click(page, "compare-tab-map"); await settle(net); }
      const mapSel = '[data-testid="card-map"] .leaflet-container';
      // The map's top goes 2 px below the top of the stuck bar, so the bar's middle lies over the map.
      await page.evaluate((sel) => {
        const bar = document.querySelector('[data-testid="selection-bar"]');
        const map = document.querySelector(sel).getBoundingClientRect();
        window.scrollBy(0, map.top - parseFloat(getComputedStyle(bar).top) - 2);
      }, mapSel);
      await page.waitForTimeout(200);
      const hits = await page.evaluate((sel) => {
        const bar = document.querySelector('[data-testid="selection-bar"]');
        const b = bar.getBoundingClientRect(), m = document.querySelector(sel).getBoundingClientRect();
        const y = b.top + b.height / 2;
        return [0.1, 0.5, 0.9].map((f) => {
          const el = document.elementFromPoint(m.left + m.width * f, y);
          return { onBar: !!el && bar.contains(el), mapUnder: m.top < y && m.bottom > y, cls: el?.className?.toString().slice(0, 40) };
        });
      }, mapSel);
      check(`sticky bar: the map does not cover the Selection bar at ${label}`, hits.every((h) => h.onBar && h.mapUnder), { hits });
      await p.ctx.close();
    }

    // Ctrl + wheel zoom: a trackpad pinch sends many small events, which add up; a mouse notch gives one level.
    p = await openPage("/");
    ({ page, net } = p);
    await settle(net);
    await page.locator('[data-testid="card-map"] .leaflet-container').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    // The zoom level from the DOM: the distance between two Arrondissement labels doubles at each level.
    const spread = () => page.evaluate(() => {
      const pts = [...document.querySelectorAll(".map-label")].map((l) => { const r = l.getBoundingClientRect(); return [l.textContent, r.x + r.width / 2, r.y + r.height / 2]; });
      return Object.fromEntries(pts.map(([t, x, y]) => [t, [x, y]]));
    });
    const levels = (a, b) => {
      const keys = Object.keys(a).filter((k) => b[k]);
      const d = (s, i, j) => Math.hypot(s[keys[i]][0] - s[keys[j]][0], s[keys[i]][1] - s[keys[j]][1]);
      return keys.length < 2 ? null : Math.log2(d(b, 0, keys.length - 1) / d(a, 0, keys.length - 1));
    };
    // deltaMode 0 is pixels, 1 is lines (a Firefox mouse notch) and 2 is pages.
    const ctrlWheel = (deltaY, count, gapMs, deltaMode = 0) => page.evaluate(async ([deltaY, count, gapMs, deltaMode]) => {
      const el = document.querySelector('[data-testid="card-map"] .leaflet-container');
      const r = el.getBoundingClientRect();
      for (let i = 0; i < count; i++) {
        el.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode, ctrlKey: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, cancelable: true }));
        await new Promise((res) => setTimeout(res, gapMs));
      }
    }, [deltaY, count, gapMs, deltaMode]);
    let s0 = await spread();
    await ctrlWheel(-3, 20, 10);
    await page.waitForTimeout(400);
    const pinch = levels(s0, await spread());
    check("pinch zoom: 20 small Ctrl + wheel events zoom in by at most 1 level", pinch !== null && pinch <= 1.05, { levels: pinch && Math.round(pinch * 100) / 100 });
    // A fresh map, since the pinch above may have reached the maximum zoom.
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[data-testid="card-map"] .leaflet-container').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    s0 = await spread();
    await ctrlWheel(-100, 1, 0);
    await page.waitForTimeout(400);
    const notch = levels(s0, await spread());
    check("pinch zoom: one Ctrl + wheel notch zooms in by 1 level", notch !== null && Math.abs(notch - 1) < 0.05, { levels: notch && Math.round(notch * 100) / 100 });
    // A notch in lines (Firefox: 3 lines) and in pages (1 page) also gives one level.
    for (const [label, deltaY, deltaMode] of [["3 lines", -3, 1], ["1 page", -1, 2]]) {
      await page.reload({ waitUntil: "networkidle" });
      await page.locator('[data-testid="card-map"] .leaflet-container').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      s0 = await spread();
      await ctrlWheel(deltaY, 1, 0, deltaMode);
      await page.waitForTimeout(400);
      const lv = levels(s0, await spread());
      check(`pinch zoom: one Ctrl + wheel notch of ${label} zooms in by 1 level`, lv !== null && Math.abs(lv - 1) < 0.05, { levels: lv && Math.round(lv * 100) / 100 });
    }
    await p.ctx.close();

    // In print, the ranking shows every row: its scroll box has no height cap, even at a desktop width.
    p = await openPage("/", { viewport: { width: 1024, height: 900 } });
    ({ page, net } = p);
    await settle(net);
    await page.emulateMedia({ media: "print" });
    await page.waitForTimeout(200);
    const printed = await page.evaluate(() => {
      const box = document.querySelector('[data-testid="list-ranking"] [data-testid^="row-rank-"]').parentElement;
      const b = box.getBoundingClientRect();
      const rows = [...box.querySelectorAll('[data-testid^="row-rank-"]')];
      const clipped = rows.filter((r) => { const q = r.getBoundingClientRect(); return q.top < b.top - 1 || q.bottom > b.bottom + 1; }).length;
      return { scrollHeight: box.scrollHeight, clientHeight: box.clientHeight, rows: rows.length, clipped };
    });
    check("print: the ranking shows every row at 1024 px", printed.rows > 0 && printed.scrollHeight <= printed.clientHeight + 1 && printed.clipped === 0, printed);
    await p.ctx.close();

    // The heat map's Focus button only selects: it never clicks off the Area already selected.
    p = await openPage("/?arr=11");
    ({ page, net } = p);
    await settle(net);
    await click(page, "areas-tab-quarters");
    await settle(net);
    await page.click('[data-testid="heat-row-11"] + button');
    await click(page, "button-heat-focus");
    await settle(net);
    await page.waitForTimeout(200);
    const focusArr = new URL(page.url()).searchParams.get("arr");
    check("heat map: Focus on the selected Area keeps it selected", focusArr === "11", { arr: focusArr });
    await p.ctx.close();

    // The skip link moves the focus without a new history entry, so Back still goes to the previous Selection.
    p = await openPage("/?arr=5");
    ({ page, net } = p);
    await settle(net);
    await click(page, "filter-arr-9");
    await settle(net);
    const histBefore = await page.evaluate(() => history.length);
    await page.focus('a[href="#figures"]');
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    const skip = await page.evaluate(() => ({ history: history.length, active: document.activeElement?.id }));
    check("skip link: it focuses the figures and adds no history entry", skip.history === histBefore && skip.active === "figures", { before: histBefore, ...skip });
    await p.ctx.close();

    // The language: the browser's first language, a saved choice, and the Selection kept in the URL.
    const langOf = (page) => page.evaluate(() => ({ html: document.documentElement.lang, title: document.title,
      en: document.querySelector('[data-testid="lang-en"]')?.getAttribute("aria-pressed"), fr: document.querySelector('[data-testid="lang-fr"]')?.getAttribute("aria-pressed") }));
    p = await openPage("/", { locale: "fr-FR" });
    const frDefault = await langOf(p.page);
    await p.ctx.close();
    p = await openPage("/", { locale: "en-GB" });
    const enDefault = await langOf(p.page);
    check("lang-default: a French browser gets French, an English one English",
      frDefault.html === "fr" && frDefault.fr === "true" && enDefault.html === "en" && enDefault.en === "true", { frDefault, enDefault });
    await click(p.page, "lang-fr");
    await p.page.waitForSelector('[data-testid="card-kpi-0"]');
    const langSwitched = await langOf(p.page);
    await p.page.reload({ waitUntil: "networkidle" });
    await p.page.waitForSelector('[data-testid="card-kpi-0"]');
    const langReloaded = await langOf(p.page);
    check("lang-switch: the switch sets French and it stays after a reload",
      langSwitched.html === "fr" && langSwitched.title === "Ventes immobilières à Paris et alentours" && langReloaded.html === "fr" && langReloaded.fr === "true", { langSwitched, langReloaded });
    await p.ctx.close();

    p = await openPage("/?arr=11&type=Appartement", { locale: "fr-FR" });
    await settle(p.net);
    const url0 = p.page.url();
    await click(p.page, "lang-en");
    await p.page.waitForSelector('[data-testid="card-kpi-0"]');
    await click(p.page, "lang-fr");
    await p.page.waitForSelector('[data-testid="card-kpi-0"]');
    const kept = { url: p.page.url(), name: await p.page.textContent('[data-testid="text-area-name"]') };
    check("lang-keeps-selection: a switch keeps the URL and adds no lang parameter",
      kept.url === url0 && !new URL(kept.url).searchParams.has("lang") && /11e/.test(kept.name ?? ""), { url0, ...kept });
    await p.ctx.close();

    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "fr-FR" });
      const page = await ctx.newPage();
      await page.route(/arcgisonline|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      if (DIST) await page.route((u) => u.origin === new URL(BASE).origin && !u.pathname.startsWith("/api"), async (r) => {
        const u = new URL(r.request().url());
        const f = extname(u.pathname) ? u.pathname.slice(1) : "index.html";
        try { await r.fulfill({ body: await readFile(join(DIST, f)), contentType: MIME[extname(f)] ?? "application/octet-stream" }); } catch { await r.abort(); }
      });
      await page.addInitScript(() => Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } }));
      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await page.waitForSelector('[data-testid="card-kpi-0"]', { timeout: 15000 }).catch(() => {});
      const loaded = await langOf(page);
      await page.click('[data-testid="lang-en"]').catch(() => {});
      await page.waitForTimeout(300);
      const after = await langOf(page);
      check("lang-without-storage: the page loads in the browser's language and the switch still works", loaded.html === "fr" && loaded.fr === "true" && after.html === "en" && after.en === "true", { loaded, after });
      await ctx.close();
    }

    // The author links, on a laptop and on a phone.
    for (const width of [1440, 375]) {
      p = await openPage("/", { viewport: { width, height: 900 } });
      const links = await p.page.evaluate(() => ["link-author-site", "link-author-github"].map((id) => {
        const a = document.querySelector(`header [data-testid="${id}"]`);
        const r = a?.getBoundingClientRect();
        return a && { href: a.getAttribute("href"), target: a.getAttribute("target"), rel: a.getAttribute("rel"), visible: !!r && r.width > 0 && r.right <= innerWidth };
      }));
      const [site, gh] = links;
      check(`author-links: both links show in the header at ${width} px`,
        !!site && !!gh && site.visible && gh.visible && site.href === "https://sagar-pal.dev" && gh.href === "https://github.com/palsagar/paris-property-sales"
          && links.every((l) => l.target === "_blank" && /noopener/.test(l.rel ?? "")), { links });
      await p.ctx.close();
    }

    // Print: the switch and the buttons hide, the author line stays.
    p = await openPage("/");
    await p.page.emulateMedia({ media: "print" });
    const printHeader = await p.page.evaluate(() => {
      const shown = (sel) => { const e = document.querySelector(sel); return !!e && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility !== "hidden"; };
      return { lang: shown('[data-testid="lang-en"]'), copy: shown('[data-testid="button-copy-link"]'), author: shown('header [data-testid="link-author-site"]') };
    });
    check("print-header: the switch and the buttons hide in print, the author line stays", !printHeader.lang && !printHeader.copy && printHeader.author, printHeader);
    await p.ctx.close();

    // french-frame: no English left in the page frame, the Selection bar and the key figures, nor in the pickers.
    {
      const left = {};
      for (const path of ["/", "/?q=7510501", "/?commune=93048"]) {
        p = await openPage(path, { locale: "fr-FR" });
        await settle(p.net);
        for (const scope of ["header", "intro", "selection-bar", "focus-header", "kpis"]) {
          const found = await frenchSweep(p.page, scope);
          if (found.length) left[`${path} ${scope}`] = found;
        }
        await p.ctx.close();
      }
      p = await openPage("/", { locale: "fr-FR" });
      await settle(p.net);
      await click(p.page, "button-area");
      await p.page.waitForSelector('[data-testid="area-picker"]');
      let found = await frenchSweep(p.page, "area-picker");
      if (found.length) left["area picker"] = found;
      await p.page.keyboard.press("Escape");
      await click(p.page, "button-period");
      await p.page.waitForSelector('[data-testid="time-control"]');
      found = await frenchSweep(p.page, "time-control");
      if (found.length) left["period picker"] = found;
      await p.ctx.close();
      p = await openPage("/", { locale: "fr-FR", viewport: { width: 375, height: 800 } });
      await settle(p.net);
      await click(p.page, "button-selection");
      await p.page.waitForSelector("[data-vaul-drawer]");
      await p.page.waitForTimeout(500);
      await p.page.evaluate(() => document.querySelector("[data-vaul-drawer]").setAttribute("data-testid", "sheet"));
      found = await frenchSweep(p.page, "sheet");
      if (found.length) left["selection sheet"] = found;
      await p.ctx.close();
      check("french-frame: no English in the frame, the Selection bar, the key figures and the pickers", Object.keys(left).length === 0, { left });
    }
  },

  /** Each control sends its Umami event, with only the agreed properties and nothing about a single Sale. */
  async analytics() {
    const all = [];
    const events = async (page) => page.evaluate(() => window.__events);
    // Runs one action and returns the events it sent.
    const sent = async (p, act) => {
      const before = (await events(p.page)).length;
      await act();
      await settle(p.net);
      await p.page.waitForTimeout(50);
      const now = await events(p.page);
      return now.slice(before);
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

    let p = await openPage("/", { umami: true });
    await settle(p.net);
    let ev = await events(p.page);
    check("analytics: one page view, without the query string, and no open event on a plain visit",
      ev.filter(([n]) => n === "pageview").length === 1 && ev[0]?.[1]?.url === "/" && !ev.some(([n]) => n === "open"), { events: ev.map(([n]) => n) });

    const expect = async (name, act, want) => {
      const got = await sent(p, act);
      all.push(...got);
      check(`analytics: ${name}`, same(got, want), { got });
    };
    await expect("a click on Paris while Paris is selected sends nothing", () => click(p.page, "filter-arr-all"), []);
    await expect("an Area button", () => click(p.page, "filter-arr-5"),
      [["select-area", { level: "arrondissement", area: "Paris 5e", code: "5", via: "buttons" }]]);
    // The Sales list first, while the Selection still has many pages.
    await expect("a sort of the Sales list", () => click(p.page, "sort-price"), [["sort-sales", { column: "price", dir: "desc" }]]);
    await expect("a page of the Sales list", () => click(p.page, "button-next"), [["page-sales", { page: 2 }]]);
    await expect("a property type", () => click(p.page, "filter-type-Maison"), [["select-property-type", { type: "house" }]]);
    await expect("a click on the property type already chosen sends nothing", () => click(p.page, "filter-type-Maison"), []);
    const last12 = { from: (() => { const [y, m] = datasetTo.split("-").map(Number); const d = new Date(Date.UTC(y, m - 12, 1)); return d.toISOString().slice(0, 7); })(), to: datasetTo.slice(0, 7) };
    await expect("a Period preset", () => click(p.page, "preset-last-12-months"),
      [["change-period", { via: "preset", preset: "last-12-months", ...last12 }]]);
    await expect("a map mode", () => click(p.page, "map-mode-change"), [["change-map-mode", { mode: "change" }]]);
    await expect("a click on the map mode already chosen sends nothing", () => click(p.page, "map-mode-change"), []);
    await expect("back to the price map", () => click(p.page, "map-mode-level"), [["change-map-mode", { mode: "level" }]]);
    await p.page.focus('[data-testid="slider-travel"]');
    await expect("a key that does not move the map's quarter slider sends nothing", () => p.page.keyboard.press("End"), []);
    await expect("a key that moves the map's quarter slider", () => p.page.keyboard.press("ArrowLeft"), [["time-travel", { via: "slider" }]]);
    await expect("a CSV download", () => click(p.page, "button-csv-trend"), [["export-csv", { panel: "trend" }]]);
    await expect("print", () => click(p.page, "button-pdf"), [["print", null]]);

    // The slider sends one event, at the release, whatever the number of drag frames.
    await reveal(p.page, "time-control");
    const handle = p.page.locator('[data-testid="time-control"] .recharts-brush-traveller').first();
    const box = await handle.boundingBox();
    const brush = await p.page.locator('[data-testid="time-control"] .recharts-brush').first().boundingBox();
    const y = box.y + box.height / 2;
    const slid = await sent(p, async () => {
      await p.page.mouse.move(box.x + box.width / 2, y);
      await p.page.mouse.down();
      await p.page.mouse.move(brush.x + brush.width * 0.3, y, { steps: 8 });
      await p.page.mouse.up();
    });
    all.push(...slid);
    const u = new URL(p.page.url()).searchParams;
    check("analytics: the slider sends one event at its release",
      same(slid, [["change-period", { via: "slider", from: u.get("from")?.slice(0, 7), to: u.get("to")?.slice(0, 7) }]]), { got: slid });
    // Back to the full range: no months, as for the "All dates" preset. The end handle is already at the last month.
    const start = await handle.boundingBox();
    const full = await sent(p, async () => {
      await p.page.mouse.move(start.x + start.width / 2, y);
      await p.page.mouse.down();
      await p.page.mouse.move(brush.x - 20, y, { steps: 8 });
      await p.page.mouse.up();
    });
    all.push(...full);
    check("analytics: a slider dragged back to the full range sends no months", same(full, [["change-period", { via: "slider" }]]) && !new URL(p.page.url()).searchParams.has("from"), { got: full });

    // The search box: the event names the Area chosen, never the text typed.
    const typed = "odeo";
    const found = await sent(p, async () => { await search(p, typed); await p.page.keyboard.press("Enter"); });
    all.push(...found);
    check("analytics: the search box sends the Area chosen, not the text typed",
      found.length === 1 && found[0][0] === "select-area" && found[0][1].via === "search" && found[0][1].level === "quartier" && !JSON.stringify(found).includes(typed), { got: found });
    all.push(...(await events(p.page)).filter(([n]) => n === "pageview"));
    await p.ctx.close();

    // A click back to the option on screen, while the first click loads, is kept: the page ends on the last choice.
    p = await openPage("/", { umami: true });
    await settle(p.net);
    await delay(p.page, /\/api\/sales\/trend\?/, 1500);
    const raced = await sent(p, async () => {
      await click(p.page, "gran-month");
      await p.page.waitForTimeout(200);
      await click(p.page, "gran-quarter");
    });
    await p.page.waitForTimeout(300);
    const granNow = { url: new URL(p.page.url()).searchParams.get("gran"), quarter: await p.page.getAttribute('[data-testid="gran-quarter"]', "aria-pressed") };
    check("analytics: a click back to the option on screen while the first click loads is kept",
      granNow.url === null && granNow.quarter === "true" && same(raced, [["change-granularity", { gran: "month" }], ["change-granularity", { gran: "quarter" }]]), { ...granNow, got: raced });
    all.push(...raced);
    await p.ctx.close();

    // A link that carries settings, and a dot.
    p = await openPage("/?arr=6&map=dots&level=quartier", { umami: true });
    await settle(p.net);
    ev = await events(p.page);
    all.push(...ev);
    const open = ev.find(([n]) => n === "open")?.[1];
    check("analytics: a link with settings sends one open event with its Selection",
      ev.filter(([n]) => n === "open").length === 1 && same(open, { level: "arrondissement", area: "Paris 6e", code: "6", type: "all", map: "dots" }), { open });
    const dot = await findDot(p.page);
    let fromDot = [];
    if (dot) fromDot = await sent(p, () => p.page.mouse.click(dot.x, dot.y));
    all.push(...fromDot);
    check("analytics: a dot sends only the Area it selects",
      !!dot && fromDot.length === 1 && fromDot[0][0] === "select-area" && same(Object.keys(fromDot[0][1]), ["level", "area", "code", "via"])
        && fromDot[0][1].via === "dot" && fromDot[0][1].level === "quartier", { found: !!dot, got: fromDot });
    await p.ctx.close();

    // The language switch and the author links.
    p = await openPage("/", { umami: true });
    await settle(p.net);
    await expect("a click on the language already chosen sends nothing", () => click(p.page, "lang-en"), []);
    await expect("a language change", () => click(p.page, "lang-fr"), [["change-language", { to: "fr" }]]);
    await p.page.waitForSelector('[data-testid="card-kpi-0"]');
    // The links open a new tab: keep the click in this page.
    await p.page.evaluate(() => document.addEventListener("click", (e) => { if (e.target.closest?.("a[target=_blank]")) e.preventDefault(); }, true));
    await expect("the author's site", () => click(p.page, "link-author-site"), [["author-link", { target: "site" }]]);
    await expect("the GitHub link", () => click(p.page, "link-author-github"), [["author-link", { target: "github" }]]);
    await p.ctx.close();

    // events-same-in-french: the same Area gives the same event in both languages.
    const areaEvent = async (locale) => {
      const q = await openPage("/", { umami: true, locale });
      await settle(q.net);
      const before = (await events(q.page)).length;
      await click(q.page, "filter-arr-11");
      await settle(q.net);
      await q.page.waitForTimeout(50);
      const got = (await events(q.page)).slice(before).filter(([n]) => n === "select-area");
      await q.ctx.close();
      return got;
    };
    const inEn = await areaEvent("en-GB"), inFr = await areaEvent("fr-FR");
    check("analytics: events-same-in-french", inEn.length === 1 && same(inEn, inFr), { inEn, inFr });

    // Every event, whatever the control: only the agreed keys, and no number but a page of the Sales list.
    const KEYS = new Set(["url", "level", "area", "code", "via", "type", "from", "to", "map", "preset", "mode", "group", "by", "gran", "on", "column", "dir", "page", "panel", "interval", "target"]);
    const bad = all.filter(([, props]) => props && Object.entries(props).some(([k, v]) => !KEYS.has(k) || (typeof v === "number" && k !== "page") || (typeof v === "string" && v.length > 60)));
    check("analytics: no event carries a key outside the agreed list, a price or a long text", all.length > 10 && bad.length === 0, { events: all.length, bad: bad.map(([n, props]) => [n, Object.keys(props)]) });
  },
};

/**
 * The position of a dot on the map: it hovers a grid of points from the centre outwards until a dot's tooltip shows.
 * A boundary's tooltip lingers for its fade, so each point waits before it reads the tooltip. Its text is never printed.
 */
async function findDot(page) {
  // The key figures now come before the map, so the map starts below the fold: bring it into view first.
  await page.locator('[data-testid="card-map"] .leaflet-container').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await page.locator('[data-testid="card-map"] .leaflet-container').boundingBox();
  const points = [];
  for (let i = 1; i < 12; i++) for (let j = 1; j < 8; j++) points.push({ x: box.x + (box.width * i) / 12, y: box.y + (box.height * j) / 8 });
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  points.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  for (const pt of points) {
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(300);
    const onDot = await page.evaluate(() => [...document.querySelectorAll(".leaflet-tooltip")].some((t) => /sold on|sales near here/.test(t.textContent)));
    if (onDot) return pt;
  }
  return null;
}

/** Records the time of each change of the heading and of the first KPI, in the page's clock. */
async function watchHeading(page) {
  await page.evaluate(() => {
    window.__names = [document.querySelector('[data-testid="text-area-name"]').textContent];
    window.__nameAt = [];
    window.__kpiAt = [];
    const obs = (sel, list, onText) => {
      const el = document.querySelector(sel);
      let last = el.textContent;
      new MutationObserver(() => { if (el.textContent !== last) { last = el.textContent; list.push(Date.now()); onText?.(last); } })
        .observe(el, { childList: true, subtree: true, characterData: true });
    };
    obs('[data-testid="text-area-name"]', window.__nameAt, (t) => window.__names.push(t));
    obs('[data-testid="text-kpi-0"]', window.__kpiAt);
  });
}

/** Delays or fails one endpoint for the rest of the page's life. */
const delay = (page, pattern, ms) => page.route(pattern, async (r) => { await new Promise((res) => setTimeout(res, ms)); await r.continue().catch(() => {}); });


/** Records a pass or fail behaviour check. */
function check(name, ok, detail = {}) {
  if (!ok) failed = true;
  const r = { name, pass: ok, ...detail };
  console.log(JSON.stringify(r));
  results.push(r);
}

for (const [name, run] of Object.entries(sections)) {
  if (only.length && !only.includes(name)) continue;
  console.log(`# ${name}`);
  await run();
}
await browser.close();

if (results.length) {
  console.log("\nstep".padEnd(36) + "work ms  longest  req  miss  commits  blanks  result");
  for (const r of results) {
    if (r.workMs === undefined) { console.log(r.name.padEnd(80) + (r.pass ? "pass" : "FAIL")); continue; }
    console.log(r.name.padEnd(35) + String(r.workMs).padStart(7) + String(r.longestTaskMs).padStart(9) + String(r.requests).padStart(5)
      + String(r.misses).padStart(6) + String(r.commits).padStart(9) + String(r.blanks).padStart(8) + "  " + (r.pass ? "pass" : "FAIL"));
  }
}
console.log(failed ? "\nFAIL" : "\nPASS");
process.exit(failed ? 1 : 0);
