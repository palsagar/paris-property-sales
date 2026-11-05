import type { SalesDb, SqlParams } from "./salesDb";
import {
  bucketInfo,
  changeFromRow,
  changeSelect,
  type Change,
  type ChangeRow,
  type ChangeWindows,
  type Granularity,
  ordinalSql,
} from "./timeStats";

export interface SaleFilter {
  propertyType?: string;
  arrondissement?: number;
  quartier?: string;
  from?: string;
  to?: string;
}

/** A WHERE clause for the filter. Dates compare as text, so a date that does not exist never raises an error. */
export function saleWhere(f: SaleFilter): { sql: string; params: SqlParams } {
  const conditions: string[] = [];
  const params: SqlParams = {};
  if (f.propertyType && f.propertyType !== "all") {
    conditions.push("property_type = $fType");
    params["fType"] = f.propertyType;
  }
  if (f.arrondissement !== undefined) {
    conditions.push("arr = $fArr::INTEGER");
    params["fArr"] = f.arrondissement;
  }
  if (f.quartier !== undefined) {
    conditions.push("quartier = $fQuartier");
    params["fQuartier"] = f.quartier;
  }
  if (f.from !== undefined) {
    conditions.push("sale_date >= $fFrom");
    params["fFrom"] = f.from;
  }
  if (f.to !== undefined) {
    conditions.push("sale_date <= $fTo");
    params["fTo"] = f.to;
  }
  return { sql: conditions.length ? conditions.join(" AND ") : "TRUE", params };
}

const med = (column: string) => `coalesce(quantile_cont(${column}, 0.5), 0)::DOUBLE`;

export async function summaryStats(db: SalesDb, f: SaleFilter, w: ChangeWindows | null) {
  const where = saleWhere(f);
  const change = changeSelect(w);
  const [row] = await db.query<
    {
      count: number;
      totalVolume: number;
      medianPrice: number;
      averagePrice: number;
      medianPricePerSqm: number;
      averagePricePerSqm: number;
      medianSurface: number;
      minPrice: number;
      maxPrice: number;
    } & ChangeRow
  >(
    `SELECT count(*)::INTEGER AS count,
      coalesce(sum(price), 0)::DOUBLE AS totalVolume,
      ${med("price")} AS medianPrice,
      coalesce(avg(price), 0)::DOUBLE AS averagePrice,
      ${med("price_per_sqm")} AS medianPricePerSqm,
      coalesce(avg(price_per_sqm), 0)::DOUBLE AS averagePricePerSqm,
      ${med("surface")} AS medianSurface,
      coalesce(min(price), 0)::DOUBLE AS minPrice,
      coalesce(max(price), 0)::DOUBLE AS maxPrice,
      ${change.sql}
    FROM sales WHERE ${where.sql}`,
    { ...where.params, ...change.params },
  );
  const { nStart, nEnd, startPpsm, endPpsm, startPrice, endPrice, ...stats } = row!;
  return { ...stats, ...changeFromRow({ nStart, nEnd, startPpsm, endPpsm, startPrice, endPrice }) };
}

const NICE_STEPS = [1, 2, 2.5, 5, 10];

function niceStep(raw: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const f of NICE_STEPS) {
    if (f * magnitude >= raw) return f * magnitude;
  }
  return 10 * magnitude;
}

export async function distribution(
  db: SalesDb,
  f: SaleFilter,
  column: "price" | "price_per_sqm",
  targetBins: number,
) {
  const where = saleWhere(f);
  const [s] = await db.query<{
    n: number; min: number | null; mean: number | null;
    p10: number | null; p25: number | null; p50: number | null;
    p75: number | null; p90: number | null; p99: number | null;
  }>(
    `SELECT count(*)::INTEGER AS n, min(${column})::DOUBLE AS min, avg(${column})::DOUBLE AS mean,
      quantile_cont(${column}, 0.1)::DOUBLE AS p10, quantile_cont(${column}, 0.25)::DOUBLE AS p25,
      quantile_cont(${column}, 0.5)::DOUBLE AS p50, quantile_cont(${column}, 0.75)::DOUBLE AS p75,
      quantile_cont(${column}, 0.9)::DOUBLE AS p90, quantile_cont(${column}, 0.99)::DOUBLE AS p99
    FROM sales WHERE ${where.sql}`,
    where.params,
  );
  if (!s || s.n === 0) {
    return { bins: [], median: 0, mean: 0, p10: 0, p25: 0, p75: 0, p90: 0 };
  }
  // The chart range stops at the 99th percentile, as before.
  const start0 = s.min!;
  const step = niceStep((s.p99! - start0) / targetBins);
  const start = Math.floor(start0 / step) * step;
  const binCount = Math.max(1, Math.ceil((s.p99! - start) / step));
  const bins = Array.from({ length: binCount }, (_, i) => ({
    from: Math.round(start + i * step),
    to: Math.round(start + (i + 1) * step),
    count: 0,
  }));
  if (bins.length > 0) {
    const rows = await db.query<{ idx: number; n: number }>(
      `SELECT floor((v - $start::DOUBLE) / $step::DOUBLE)::INTEGER AS idx, count(*)::INTEGER AS n
      FROM (SELECT ${column} AS v FROM sales WHERE ${where.sql}) GROUP BY idx`,
      { ...where.params, start, step },
    );
    for (const r of rows) {
      if (r.idx >= 0 && r.idx < binCount) bins[r.idx]!.count = r.n;
    }
  }
  return { bins, median: s.p50!, mean: s.mean!, p10: s.p10!, p25: s.p25!, p75: s.p75!, p90: s.p90! };
}

export async function salesByRooms(db: SalesDb, f: SaleFilter) {
  const where = saleWhere(f);
  return db.query<{
    rooms: number; count: number; medianPrice: number; medianPricePerSqm: number; medianSurface: number;
  }>(
    `SELECT least(rooms, 5)::INTEGER AS rooms, count(*)::INTEGER AS count,
      quantile_cont(price, 0.5)::DOUBLE AS medianPrice,
      quantile_cont(price_per_sqm, 0.5)::DOUBLE AS medianPricePerSqm,
      quantile_cont(surface, 0.5)::DOUBLE AS medianSurface
    FROM sales WHERE rooms >= 1 AND ${where.sql}
    GROUP BY 1 ORDER BY 1`,
    where.params,
  );
}

export type AreaLevel = "arrondissement" | "quartier";

export interface AreaStat {
  area: string;
  count: number;
  medianPrice: number;
  medianPricePerSqm: number;
  p25PricePerSqm: number;
  p75PricePerSqm: number;
  medianSurface: number;
  startMedianPricePerSqm: number | null;
  endMedianPricePerSqm: number | null;
  changePct: number | null;
}

export async function areaStats(
  db: SalesDb,
  f: SaleFilter,
  level: AreaLevel,
  w: ChangeWindows | null,
): Promise<AreaStat[]> {
  const where = saleWhere(f);
  const change = changeSelect(w);
  const areaExpr = level === "quartier" ? "quartier" : "arr::VARCHAR";
  const rows = await db.query<
    {
      area: string; count: number; medianPrice: number; medianPricePerSqm: number;
      p25PricePerSqm: number; p75PricePerSqm: number; medianSurface: number;
    } & ChangeRow
  >(
    `SELECT ${areaExpr} AS area, count(*)::INTEGER AS count,
      quantile_cont(price, 0.5)::DOUBLE AS medianPrice,
      quantile_cont(price_per_sqm, 0.5)::DOUBLE AS medianPricePerSqm,
      quantile_cont(price_per_sqm, 0.25)::DOUBLE AS p25PricePerSqm,
      quantile_cont(price_per_sqm, 0.75)::DOUBLE AS p75PricePerSqm,
      quantile_cont(surface, 0.5)::DOUBLE AS medianSurface,
      ${change.sql}
    FROM sales WHERE ${level === "quartier" ? "quartier IS NOT NULL AND " : ""}${where.sql}
    GROUP BY ${level === "quartier" ? "quartier" : "arr"} ORDER BY ${level === "quartier" ? "quartier" : "arr"}`,
    { ...where.params, ...change.params },
  );
  return rows.map(({ nStart, nEnd, startPpsm, endPpsm, startPrice, endPrice, ...r }) => {
    const c: Change = changeFromRow({ nStart, nEnd, startPpsm, endPpsm, startPrice, endPrice });
    return {
      ...r,
      startMedianPricePerSqm: c.startMedianPricePerSqm,
      endMedianPricePerSqm: c.endMedianPricePerSqm,
      changePct: c.changePct,
    };
  });
}

/**
 * Pools each bucket with the previous windowSize-1 buckets, for every ordinal from first to last.
 * The inner join skips empty pools. `areaExpr` adds an Area to the select and the GROUP BY.
 */
function pooledQuery(
  f: SaleFilter,
  g: Granularity,
  windowSize: number,
  first: number,
  last: number,
  areaExpr: string | null,
  extraWhere: string,
  measures: string,
) {
  const where = saleWhere(f);
  const area = areaExpr ? `${areaExpr} AS area, ` : "";
  return {
    sql: `WITH s AS (SELECT ${area}price, price_per_sqm, ${ordinalSql(g)} AS o FROM sales WHERE ${extraWhere}${where.sql}),
      buckets AS (SELECT unnest(range($tFirst::INTEGER, $tLast::INTEGER + 1))::INTEGER AS b)
    SELECT ${areaExpr ? "area, " : ""}b, count(*)::INTEGER AS count, ${measures}
    FROM buckets JOIN s ON s.o BETWEEN b - $tWindow::INTEGER + 1 AND b
    GROUP BY ${areaExpr ? "area, " : ""}b`,
    params: { ...where.params, tFirst: first, tLast: last, tWindow: windowSize },
  };
}

export async function trendPoints(
  db: SalesDb,
  f: SaleFilter,
  g: Granularity,
  windowSize: number,
  first: number,
  last: number,
) {
  const q = pooledQuery(f, g, windowSize, first, last, null, "",
    `quantile_cont(price, 0.5)::DOUBLE AS "medianPrice",
      quantile_cont(price_per_sqm, 0.5)::DOUBLE AS "medianPricePerSqm",
      quantile_cont(price_per_sqm, 0.25)::DOUBLE AS "p25PricePerSqm",
      quantile_cont(price_per_sqm, 0.75)::DOUBLE AS "p75PricePerSqm"`);
  const rows = await db.query<{
    b: number; count: number; medianPrice: number; medianPricePerSqm: number;
    p25PricePerSqm: number; p75PricePerSqm: number;
  }>(`${q.sql} ORDER BY b`, q.params);
  return rows.map(({ b, ...r }) => ({ ...bucketInfo(b, g), ...r }));
}

export async function areaTrendPoints(
  db: SalesDb,
  f: SaleFilter,
  level: AreaLevel,
  g: Granularity,
  windowSize: number,
  first: number,
  last: number,
) {
  const q = pooledQuery(
    f, g, windowSize, first, last,
    level === "quartier" ? "quartier" : "arr::VARCHAR",
    level === "quartier" ? "quartier IS NOT NULL AND " : "",
    `quantile_cont(price_per_sqm, 0.5)::DOUBLE AS "medianPricePerSqm"`,
  );
  const rows = await db.query<{ area: string; b: number; count: number; medianPricePerSqm: number }>(q.sql, q.params);
  return rows
    .map(({ area, b, count, medianPricePerSqm }) => ({ id: area, ...bucketInfo(b, g), count, medianPricePerSqm }))
    .sort((a, b) =>
      a.period === b.period
        ? a.id.localeCompare(b.id, undefined, { numeric: true })
        : a.period.localeCompare(b.period),
    );
}

export async function salePoints(db: SalesDb, f: SaleFilter) {
  const where = saleWhere(f);
  return db.query<{
    id: string; lon: number; lat: number; price: number; surface: number; pricePerSqm: number;
    arrondissement: number; date: string; type: string; address: string;
  }>(
    `SELECT id, lon, lat, price, surface, price_per_sqm AS "pricePerSqm", arr AS arrondissement,
      sale_date AS "date", property_type AS "type", street AS "address"
    FROM sales WHERE lon IS NOT NULL AND lat IS NOT NULL AND ${where.sql}
    ORDER BY sale_date DESC, id`,
    where.params,
  );
}

const SORT_COLUMNS = {
  date: "sale_date",
  price: "price",
  pricePerSqm: "price_per_sqm",
  surface: "surface",
} as const;

export async function transactionPage(
  db: SalesDb,
  f: SaleFilter,
  sortBy: keyof typeof SORT_COLUMNS,
  sortDir: "asc" | "desc",
  limit: number,
  offset: number,
) {
  const where = saleWhere(f);
  const order = `${SORT_COLUMNS[sortBy]} ${sortDir === "asc" ? "ASC" : "DESC"}, id`;
  const [count] = await db.query<{ total: number }>(
    `SELECT count(*)::INTEGER AS total FROM sales WHERE ${where.sql}`,
    where.params,
  );
  // An offset past the last Sale gives an empty page. The check also keeps a huge offset out of the INTEGER cast below.
  if (offset >= count!.total) return { total: count!.total, items: [] };
  const items = await db.query<{
    id: string; date: string; type: string; address: string; arrondissement: number;
    quartier: string | null; price: number; surface: number; pricePerSqm: number; rooms: number;
  }>(
    `SELECT id, sale_date AS "date", property_type AS "type", street AS "address", arr AS arrondissement,
      quartier, price, surface, price_per_sqm AS "pricePerSqm", rooms
    FROM sales WHERE ${where.sql}
    ORDER BY ${order} LIMIT $tLimit::INTEGER OFFSET $tOffset::INTEGER`,
    { ...where.params, tLimit: limit, tOffset: offset },
  );
  return { total: count!.total, items };
}
