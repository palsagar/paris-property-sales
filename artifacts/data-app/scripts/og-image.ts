/**
 * Draws public/og-image.png, the link preview image (1200×630) that WhatsApp and similar apps show for a shared link.
 * It colours Paris and the three Departments on the site's price scale, with no numbers, and writes the two site names.
 *
 * Run against a running server (docker compose up): pnpm --filter @workspace/data-app run og-image
 * BASE_URL is the server to read the medians from (default http://localhost:3000). SITE_URL gives the host name shown
 * at the bottom (default https://parism2.gpuphysics.dev). Run it again after a DVF release if the colours should follow it.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { makeStepScale, quantileThresholds } from "../src/lib/colour-scale";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "../public/og-image.png");
const BOUNDARIES = path.join(here, "../../api-server/boundaries");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HOST = new URL(process.env.SITE_URL ?? "https://parism2.gpuphysics.dev").host;
const MAX_BYTES = 300 * 1024;

const W = 1200, H = 630;
// The light theme of the site (src/index.css).
const BG = "#f6f3ee", INK = "#151e32", ACCENT = "#952336", NO_DATA = "#d9d2c4";

type Stat = { id: string; group?: string; arrondissement?: number | null; medianPricePerSqm: number | null };
type Ring = [number, number][];
type Feature = { properties: { arr?: number; id?: string; group?: string }; geometry: { type: "Polygon" | "MultiPolygon"; coordinates: Ring[] | Ring[][] } };

// The params of the default view (selectionQueries): all property types, all dates.
const getStats = async (route: string): Promise<Stat[]> => {
  const r = await fetch(`${BASE}/api/sales/${route}?propertyType=all`);
  if (!r.ok) throw new Error(`${route}: HTTP ${r.status}. Start the server first (docker compose up).`);
  return r.json() as Promise<Stat[]>;
};
const readFeatures = async (file: string): Promise<Feature[]> => JSON.parse(await readFile(path.join(BOUNDARIES, file), "utf8")).features;

const [arrStats, communeStats, arrs, communes] = await Promise.all([
  getStats("by-arrondissement"), getStats("by-commune"), readFeatures("arrondissements.geojson"), readFeatures("communes.geojson"),
]);
const medians = (s: Stat[]) => s.map((x) => x.medianPricePerSqm).filter((v): v is number => v != null);
const scale = makeStepScale(quantileThresholds(medians(arrStats), medians(communeStats)));
const arrMedian = new Map(arrStats.map((s) => [s.arrondissement, s.medianPricePerSqm]));
const communeMedian = new Map(communeStats.map((s) => [s.id, s.medianPricePerSqm]));
const fill = (m: number | null | undefined) => (m == null ? NO_DATA : scale.color(m));

// Paris and the Communes of the three Departments. The Major towns lie further out and would shrink Paris.
const shapes = [
  ...communes.filter((f) => /^9[234]/.test(f.properties.id ?? "")).map((f) => ({ f, colour: fill(communeMedian.get(f.properties.id!)) })),
  ...arrs.map((f) => ({ f, colour: fill(arrMedian.get(f.properties.arr)) })),
];

// Longitude × cos(48.85°) against latitude keeps the shapes true at Paris, fitted into the right part of the image.
const K = Math.cos((48.85 * Math.PI) / 180);
const rings = (f: Feature): Ring[] => (f.geometry.type === "Polygon" ? (f.geometry.coordinates as Ring[]) : (f.geometry.coordinates as Ring[][]).flat());
const all = shapes.flatMap(({ f }) => rings(f).flat());
const xs = all.map(([lon]) => lon * K), ys = all.map(([, lat]) => -lat);
const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
const box = { left: 668, top: 24, width: 512, height: H - 48 };
const s = Math.min(box.width / (x1 - x0), box.height / (y1 - y0));
const ox = box.left + (box.width - (x1 - x0) * s) / 2, oy = box.top + (box.height - (y1 - y0) * s) / 2;
const pathOf = (f: Feature) => rings(f).map((r) => "M" + r.map(([lon, lat]) => `${((lon * K - x0) * s + ox).toFixed(1)},${((-lat - y0) * s + oy).toFixed(1)}`).join("L") + "Z").join("");
const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${shapes
  .map(({ f, colour }) => `<path d="${pathOf(f)}" fill="${colour}" stroke="${BG}" stroke-width="0.8" stroke-linejoin="round"/>`).join("")}</svg>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,700&family=IBM+Plex+Sans:wght@400;500&display=block" rel="stylesheet">
<style>
  body { margin: 0; width: ${W}px; height: ${H}px; background: ${BG}; color: ${INK}; position: relative; overflow: hidden; font-family: "IBM Plex Sans", sans-serif; }
  .map { position: absolute; inset: 0; }
  .text { position: absolute; left: 64px; top: 0; bottom: 0; width: 596px; display: flex; flex-direction: column; justify-content: center; gap: 20px; }
  .rule { width: 72px; height: 6px; background: ${ACCENT}; }
  h1, h2 { font-family: "Fraunces", serif; font-weight: 700; margin: 0; line-height: 1.08; }
  h1 { font-size: 56px; }
  h2 { font-size: 36px; color: ${ACCENT}; }
  p { margin: 0; font-size: 23px; line-height: 1.35; }
  .host { position: absolute; left: 64px; bottom: 40px; font-size: 21px; font-weight: 500; opacity: 0.7; }
</style></head><body>
<div class="map">${svg}</div>
<div class="text">
  <div class="rule"></div>
  <h1>Ventes immobilières à Paris et alentours</h1>
  <h2>Paris &amp; Suburbs Property Sales</h2>
  <p>Prix au m² et évolution, par quartier et commune.<br>Price per m² and its change, by quartier and commune.</p>
</div>
<div class="host">${HOST}</div>
</body></html>`;

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, type: "png" });
} finally {
  await browser.close();
}
const size = (await stat(OUT)).size;
console.log(`${OUT}: ${Math.round(size / 1024)} KB, ${shapes.length} Areas, ${scale.thresholds.length + 1} colours`);
if (size >= MAX_BYTES) {
  console.error(`The image is ${Math.round(size / 1024)} KB. It must stay under ${MAX_BYTES / 1024} KB.`);
  process.exit(1);
}
