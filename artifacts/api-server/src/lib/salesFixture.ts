import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import { openSalesDb, type SalesDb } from "./salesDb";

export interface FixtureSale {
  id: string;
  date: string;
  type: string;
  price: number;
  surface: number;
  pricePerSqm: number;
  rooms: number;
  /** Defaults to "75", Paris. */
  department?: string;
  /** INSEE code of the Commune. Defaults to null, as for every Sale in Paris. */
  commune?: string | null;
  arr: number | null;
  quartier: string | null;
  lon: number | null;
  lat: number | null;
  street: string;
}

export const FIXTURE_SALES: FixtureSale[] = [
  { id: "s1", date: "2024-01-10", type: "Appartement", price: 100000, surface: 10, pricePerSqm: 10000, rooms: 1, arr: 1, quartier: "7510101", lon: 2.341, lat: 48.861, street: "Rue A" },
  { id: "s2", date: "2024-01-20", type: "Appartement", price: 200000, surface: 20, pricePerSqm: 10000, rooms: 2, arr: 1, quartier: "7510101", lon: 2.342, lat: 48.862, street: "Rue B" },
  { id: "s3", date: "2024-02-15", type: "Maison", price: 300000, surface: 50, pricePerSqm: 6000, rooms: 6, arr: 2, quartier: "7510201", lon: 2.343, lat: 48.863, street: "Rue C" },
  { id: "s4", date: "2024-03-05", type: "Appartement", price: 400000, surface: 40, pricePerSqm: 10000, rooms: 3, arr: 2, quartier: "7510201", lon: 2.344, lat: 48.864, street: "Rue D" },
  { id: "s5", date: "2024-03-05", type: "Appartement", price: 500000, surface: 25, pricePerSqm: 20000, rooms: 0, arr: 3, quartier: null, lon: null, lat: null, street: "Rue E" },
];

const dirs: string[] = [];
process.on("exit", () => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** Writes the given Sales to a temporary file with the real schema, then opens it read-only. */
export async function createSalesFixture(sales: FixtureSale[]): Promise<SalesDb> {
  const dir = mkdtempSync(join(tmpdir(), "sales-fixture-"));
  dirs.push(dir);
  const file = join(dir, "sales.duckdb");

  const instance = await DuckDBInstance.create(file);
  const connection = await instance.connect();
  try {
    await connection.run(`
      CREATE TABLE sales (
        id VARCHAR NOT NULL, sale_date VARCHAR NOT NULL, property_type VARCHAR NOT NULL,
        price INTEGER NOT NULL, surface INTEGER NOT NULL, price_per_sqm INTEGER NOT NULL,
        rooms INTEGER NOT NULL, department VARCHAR NOT NULL, commune VARCHAR, arr INTEGER, quartier VARCHAR,
        lon DOUBLE, lat DOUBLE, street VARCHAR NOT NULL
      );
      CREATE TABLE metadata (key VARCHAR NOT NULL, value VARCHAR NOT NULL);
      CREATE TABLE filter_counts (name VARCHAR NOT NULL, mutations INTEGER NOT NULL);
    `);
    for (const s of sales) {
      await connection.run(
        "INSERT INTO sales VALUES ($id, $date, $type, $price, $surface, $pricePerSqm, $rooms, $department, $commune, $arr, $quartier, $lon, $lat, $street)",
        { ...s, department: s.department ?? "75", commune: s.commune ?? null },
      );
    }
  } finally {
    connection.disconnectSync();
    instance.closeSync();
  }
  return openSalesDb(file);
}
