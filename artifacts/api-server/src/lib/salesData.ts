import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface Sale {
  id: string;
  date: string;
  type: "Appartement" | "Maison";
  price: number;
  surface: number;
  pricePerSqm: number;
  rooms: number;
  arr: number;
  quartier: string | null;
  lon: number | null;
  lat: number | null;
  address: string;
}

export interface GeoFeatureCollection {
  type: string;
  features: Array<{
    type: string;
    properties: Record<string, string | number>;
    geometry: unknown;
  }>;
}

interface Dataset {
  source: string;
  period: { from: string; to: string };
  filters: Record<string, number>;
  sales: Sale[];
}

const dataDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
);

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(dataDir, file), "utf-8")) as T;
}

const dataset = readJson<Dataset>("paris-sales.json");

export const allSales: Sale[] = dataset.sales;
export const datasetMeta = {
  source: dataset.source,
  period: dataset.period,
  // Residential sales that were dropped to keep price per m2 reliable.
  excludedCount: [
    "multiple_dwellings",
    "has_commercial_premises",
    "out_of_range_price_or_surface",
    "out_of_range_price_per_sqm",
    "missing_price_or_surface",
    "bad_arrondissement",
  ].reduce((sum, key) => sum + (dataset.filters[key] ?? 0), 0),
};

export const arrondissementGeo = readJson<GeoFeatureCollection>(
  "arrondissements.geojson",
);
export const quartierGeo = readJson<GeoFeatureCollection>("quartiers.geojson");

export interface SaleFilter {
  propertyType?: string;
  arrondissement?: number;
  quartier?: string;
  from?: string;
  to?: string;
}

export const datasetRange = {
  from: allSales.reduce((m, s) => (s.date < m ? s.date : m), "9999-12-31"),
  to: allSales.reduce((m, s) => (s.date > m ? s.date : m), "0000-01-01"),
};

export const quartierNames = new Map<string, string>(
  quartierGeo.features.map((f) => [
    String(f.properties["id"]),
    String(f.properties["name"]),
  ]),
);

// Pre-grouped lists so that area-level queries do not scan all sales.
const byArrIndex = new Map<number, Sale[]>();
const byQuartierIndex = new Map<string, Sale[]>();
for (const s of allSales) {
  const a = byArrIndex.get(s.arr);
  if (a) a.push(s);
  else byArrIndex.set(s.arr, [s]);
  if (s.quartier) {
    const q = byQuartierIndex.get(s.quartier);
    if (q) q.push(s);
    else byQuartierIndex.set(s.quartier, [s]);
  }
}

export function filterSales(f: SaleFilter): Sale[] {
  const base =
    f.quartier !== undefined
      ? (byQuartierIndex.get(f.quartier) ?? [])
      : f.arrondissement !== undefined
        ? (byArrIndex.get(f.arrondissement) ?? [])
        : allSales;
  return base.filter(
    (s) =>
      (!f.propertyType || f.propertyType === "all" || s.type === f.propertyType) &&
      (f.arrondissement === undefined || s.arr === f.arrondissement) &&
      (f.quartier === undefined || s.quartier === f.quartier) &&
      (f.from === undefined || s.date >= f.from) &&
      (f.to === undefined || s.date <= f.to),
  );
}

export function percentile(sorted: ArrayLike<number>, p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export function sortedValues(sales: Sale[], pick: (s: Sale) => number): Float64Array {
  return sortedValues2(sales.map(pick));
}

export function median(values: number[]): number {
  return percentile(sortedValues2(values), 0.5);
}

/** Native numeric sort on a typed array: much faster than a comparator sort. */
export function sortedValues2(values: ArrayLike<number>): Float64Array {
  return Float64Array.from(values).sort();
}

export function mean(values: ArrayLike<number>): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i]!;
  return sum / values.length;
}

const NICE_STEPS = [1, 2, 2.5, 5, 10];

function niceStep(raw: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const f of NICE_STEPS) {
    if (f * magnitude >= raw) return f * magnitude;
  }
  return 10 * magnitude;
}

export function histogram(values: number[], targetBins: number) {
  const sorted = sortedValues2(values);
  if (sorted.length === 0) {
    return { bins: [], median: 0, mean: 0, p10: 0, p25: 0, p75: 0, p90: 0 };
  }
  // The chart range stops at the 99th percentile so that a handful of very
  // expensive sales do not flatten the rest of the distribution.
  const cap = percentile(sorted, 0.99);
  const start0 = sorted[0]!;
  const step = niceStep((cap - start0) / targetBins);
  const start = Math.floor(start0 / step) * step;
  const binCount = Math.max(1, Math.ceil((cap - start) / step));
  const bins = Array.from({ length: binCount }, (_, i) => ({
    from: Math.round(start + i * step),
    to: Math.round(start + (i + 1) * step),
    count: 0,
  }));
  for (const v of sorted) {
    const idx = Math.floor((v - start) / step);
    if (idx >= 0 && idx < binCount) bins[idx]!.count += 1;
  }
  return {
    bins,
    median: percentile(sorted, 0.5),
    mean: mean(sorted),
    p10: percentile(sorted, 0.1),
    p25: percentile(sorted, 0.25),
    p75: percentile(sorted, 0.75),
    p90: percentile(sorted, 0.9),
  };
}
