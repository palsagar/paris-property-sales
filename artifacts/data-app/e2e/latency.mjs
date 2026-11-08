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
async function openPage(path = "/", { umami = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: process.env.MOTION ? "no-preference" : "reduce" });
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

const click = (page, id) => page.click(`[data-testid="${id}"]`);

/** Opens the search box and types a name. Only the Enter that follows belongs in a measure. */
async function search(p, text) {
  await click(p.page, "button-area-search");
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
      await measure(p, `year button ${label}`, () => click(p.page, `preset-${label.replace(/\s/g, "-").toLowerCase()}`));
    }

    await click(p.page, "preset-all-dates");
    await settle(p.net);
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
      pressed: await page.getAttribute('[data-testid="filter-arr-5"]', "aria-pressed"),
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
      return { skeleton: !!card.querySelector(".animate-pulse"), chart: !!card.querySelector(".recharts-wrapper") };
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
    const pageText = await page.textContent('[data-testid="card-transactions"] span.font-num.px-2');
    const sortKept = await page.locator('[data-testid="sort-price"] svg').count() === 1;
    let st = await page.evaluate(() => ({ blanks: window.__blanks, nameAt: window.__nameAt }));
    check("panel state: no panel blanks at an Area change", st.blanks === 0, { blanks: st.blanks });
    check("panel state: the Sales list goes to its first page and keeps its sort", pageText.trim().startsWith("1 /") && sortKept, { pageText, sortKept });
    await click(page, "filter-arr-all");
    await settle(net);
    const backText = await page.textContent('[data-testid="card-transactions"] span.font-num.px-2');
    check("panel state: back on the first Area, the Sales list is on its first page", backText.trim().startsWith("1 /"), { backText });
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
    await expect("a CSV download", () => click(p.page, "button-csv-trend"), [["export-csv", { panel: "trend" }]]);
    await expect("print", () => click(p.page, "button-pdf"), [["print", null]]);

    // The slider sends one event, at the release, whatever the number of drag frames.
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

    // The search box: the event names the Area chosen, never the text typed.
    const typed = "odeo";
    const found = await sent(p, async () => { await search(p, typed); await p.page.keyboard.press("Enter"); });
    all.push(...found);
    check("analytics: the search box sends the Area chosen, not the text typed",
      found.length === 1 && found[0][0] === "select-area" && found[0][1].via === "search" && found[0][1].level === "quartier" && !JSON.stringify(found).includes(typed), { got: found });
    all.push(...(await events(p.page)).filter(([n]) => n === "pageview"));
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

    // Every event, whatever the control: only the agreed keys, and no number but a page of the Sales list.
    const KEYS = new Set(["url", "level", "area", "code", "via", "type", "from", "to", "map", "preset", "mode", "group", "by", "gran", "on", "column", "dir", "page", "panel", "interval"]);
    const bad = all.filter(([, props]) => props && Object.entries(props).some(([k, v]) => !KEYS.has(k) || (typeof v === "number" && k !== "page") || (typeof v === "string" && v.length > 60)));
    check("analytics: no event carries a key outside the agreed list, a price or a long text", all.length > 10 && bad.length === 0, { events: all.length, bad: bad.map(([n, props]) => [n, Object.keys(props)]) });
  },
};

/**
 * The position of a dot on the map: it hovers a grid of points from the centre outwards until a dot's tooltip shows.
 * A boundary's tooltip lingers for its fade, so each point waits before it reads the tooltip. Its text is never printed.
 */
async function findDot(page) {
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
