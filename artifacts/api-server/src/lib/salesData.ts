import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSalesDb, type SalesDb } from "./salesDb";

export interface GeoFeatureCollection {
  type: string;
  features: Array<{
    type: string;
    properties: Record<string, string | number>;
    geometry: unknown;
  }>;
}

const dataDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "data",
);

const boundariesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "boundaries",
);

function readBoundaries(file: string): GeoFeatureCollection {
  return JSON.parse(
    readFileSync(path.join(boundariesDir, file), "utf-8"),
  ) as GeoFeatureCollection;
}

export const salesDb: SalesDb = await openSalesDb(
  path.join(dataDir, "sales.duckdb"),
);

const [dates] = await salesDb.query<{ from: string; to: string }>(
  `SELECT min(sale_date) AS "from", max(sale_date) AS "to" FROM sales`,
);
const [source] = await salesDb.query<{ value: string }>(
  "SELECT value FROM metadata WHERE key = 'source'",
);
// Residential sales that were dropped to keep price per m2 reliable.
const [excluded] = await salesDb.query<{ total: number }>(
  `SELECT coalesce(sum(mutations), 0)::INTEGER AS total FROM filter_counts
  WHERE name IN (
    'multiple_dwellings',
    'has_commercial_premises',
    'out_of_range_price_or_surface',
    'out_of_range_price_per_sqm',
    'missing_price_or_surface',
    'bad_arrondissement'
  )`,
);

export const datasetRange = { from: dates!.from, to: dates!.to };
export const datasetMeta = {
  source: source!.value,
  excludedCount: excluded!.total,
};

export const arrondissementGeo = readBoundaries("arrondissements.geojson");
export const quartierGeo = readBoundaries("quartiers.geojson");

export const quartierNames = new Map<string, string>(
  quartierGeo.features.map((f) => [
    String(f.properties["id"]),
    String(f.properties["name"]),
  ]),
);
