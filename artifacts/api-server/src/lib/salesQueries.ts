import type { SalesDb, SqlParams } from "./salesDb";
import {
  bucketInfo,
  changeFromRow,
  changeSelect,
  type Change,
  type ChangeRow,
  type ChangeWindows,
  type Granularity,
  MIN_SALES,
  ordinalSql,
} from "./timeStats";

export interface SaleFilter {
  propertyType?: string;
  arrondissement?: number;
  quartier?: string;
  department?: string;
  commune?: string;
  from?: string;
  to?: string;
}

/**
 * A WHERE clause for the filter. Dates compare as text, so a date that does not exist never raises an error.
 * A filter with no Area means Paris. `noArea` is the condition used then, and a caller may replace it.
 */
export function saleWhere(
  f: SaleFilter,
  noArea = "department = '75'",
): { sql: string; params: SqlParams } {
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
  if (f.department !== undefined) {
    conditions.push("department = $fDepartment");
    params["fDepartment"] = f.department;
  }
  if (f.commune !== undefined) {
    conditions.push("commune = $fCommune");
    params["fCommune"] = f.commune;
  }
  if (f.arrondissement === undefined && f.quartier === undefined && f.department === undefined && f.commune === undefined) {
    conditions.push(noArea);
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

/** Gives the statistic only when the group holds enough Sales, and NULL otherwise. */
const ifEnough = (expr: string) => `CASE WHEN count(*) >= ${MIN_SALES} THEN ${expr} END`;
const quantile = (column: string, q: number) => ifEnough(`quantile_cont(${column}, ${q})::DOUBLE`);
const mean = (column: string) => ifEnough(`avg(${column})::DOUBLE`);

/** The percentage of Sales that are houses. NULL when the group is empty. */
const HOUSE_SHARE = `(100.0 * count(*) FILTER (WHERE property_type = 'Maison') / nullif(count(*), 0))::DOUBLE`;

export async function summaryStats(db: SalesDb, f: SaleFilter, w: ChangeWindows | null) {
  const where = saleWhere(f);
  const change = changeSelect(w);
  const [row] = await db.query<
    {
      count: number;
      totalVolume: number;
      medianPrice: number | null;
      averagePrice: number | null;
      medianPricePerSqm: number | null;
      averagePricePerSqm: number | null;
      medianSurface: number | null;
      minPrice: number;
      maxPrice: number;
      houseShare: number | null;
    } & ChangeRow
  >(
    `SELECT count(*)::INTEGER AS count,
      coalesce(sum(price), 0)::DOUBLE AS totalVolume,
      ${quantile("price", 0.5)} AS medianPrice,
      ${mean("price")} AS averagePrice,
      ${quantile("price_per_sqm", 0.5)} AS medianPricePerSqm,
      ${mean("price_per_sqm")} AS averagePricePerSqm,
      ${quantile("surface", 0.5)} AS medianSurface,
      coalesce(min(price), 0)::DOUBLE AS minPrice,
      coalesce(max(price), 0)::DOUBLE AS maxPrice,
      ${HOUSE_SHARE} AS houseShare,
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
): Promise<{
  bins: { from: number; to: number; count: number }[];
  median: number | null; mean: number | null;
  p10: number | null; p25: number | null; p75: number | null; p90: number | null;
}> {
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
  if (!s || s.n < MIN_SALES) {
    return { bins: [], median: null, mean: null, p10: null, p25: null, p75: null, p90: null };
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
    rooms: number; count: number; medianPrice: number | null; medianPricePerSqm: number | null;
    medianSurface: number | null; houseShare: number | null;
  }>(
    `SELECT least(rooms, 5)::INTEGER AS rooms, count(*)::INTEGER AS count,
      ${quantile("price", 0.5)} AS medianPrice,
      ${quantile("price_per_sqm", 0.5)} AS medianPricePerSqm,
      ${quantile("surface", 0.5)} AS medianSurface,
      ${HOUSE_SHARE} AS houseShare
    FROM sales WHERE rooms >= 1 AND ${where.sql}
    GROUP BY 1 ORDER BY 1`,
    where.params,
  );
}

export type AreaLevel = "arrondissement" | "quartier" | "commune";

/** For each level, the column that names the Area, a condition that keeps its Sales, and what a filter with no Area means. */
const AREA_LEVELS: Record<AreaLevel, { column: string; expr: string; condition: string; noArea?: string }> = {
  arrondissement: { column: "arr", expr: "arr::VARCHAR", condition: "arr IS NOT NULL" },
  quartier: { column: "quartier", expr: "quartier", condition: "quartier IS NOT NULL" },
  commune: { column: "commune", expr: "commune", condition: "commune IS NOT NULL", noArea: "commune IS NOT NULL" },
};

/** The name of the place of a Sale: its Arrondissement in Paris, otherwise its Commune. */
export function saleAreaName(arr: number | null, commune: string | null, names: Map<string, string>): string {
  if (arr !== null) return `${arr === 1 ? "1er" : `${arr}e`} arrondissement`;
  return (commune && names.get(commune)) ?? commune ?? "";
}

export interface AreaStat {
  area: string;
  count: number;
  medianPrice: number | null;
  medianPricePerSqm: number | null;
  p25PricePerSqm: number | null;
  p75PricePerSqm: number | null;
  medianSurface: number | null;
  houseShare: number | null;
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
  const lv = AREA_LEVELS[level];
  const where = saleWhere(f, lv.noArea);
  const change = changeSelect(w);
  const rows = await db.query<
    {
      area: string; count: number; medianPrice: number | null; medianPricePerSqm: number | null;
      p25PricePerSqm: number | null; p75PricePerSqm: number | null; medianSurface: number | null;
      houseShare: number | null;
    } & ChangeRow
  >(
    `SELECT ${lv.expr} AS area, count(*)::INTEGER AS count,
      ${quantile("price", 0.5)} AS medianPrice,
      ${quantile("price_per_sqm", 0.5)} AS medianPricePerSqm,
      ${quantile("price_per_sqm", 0.25)} AS p25PricePerSqm,
      ${quantile("price_per_sqm", 0.75)} AS p75PricePerSqm,
      ${quantile("surface", 0.5)} AS medianSurface,
      ${HOUSE_SHARE} AS houseShare,
      ${change.sql}
    FROM sales WHERE ${lv.condition} AND ${where.sql}
    GROUP BY ${lv.column} ORDER BY ${lv.column}`,
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
  noArea?: string,
) {
  const where = saleWhere(f, noArea);
  const area = areaExpr ? `${areaExpr} AS area, ` : "";
  return {
    sql: `WITH s AS (SELECT ${area}price, price_per_sqm, property_type, ${ordinalSql(g)} AS o FROM sales WHERE ${extraWhere}${where.sql}),
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
    `${quantile("price", 0.5)} AS "medianPrice",
      ${quantile("price_per_sqm", 0.5)} AS "medianPricePerSqm",
      ${quantile("price_per_sqm", 0.25)} AS "p25PricePerSqm",
      ${quantile("price_per_sqm", 0.75)} AS "p75PricePerSqm",
      ${HOUSE_SHARE} AS "houseShare"`);
  const rows = await db.query<{
    b: number; count: number; medianPrice: number | null; medianPricePerSqm: number | null;
    p25PricePerSqm: number | null; p75PricePerSqm: number | null; houseShare: number | null;
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
  const lv = AREA_LEVELS[level];
  const q = pooledQuery(
    f, g, windowSize, first, last,
    lv.expr,
    `${lv.condition} AND `,
    `${quantile("price_per_sqm", 0.5)} AS "medianPricePerSqm", ${HOUSE_SHARE} AS "houseShare"`,
    lv.noArea,
  );
  const rows = await db.query<{
    area: string; b: number; count: number; medianPricePerSqm: number | null; houseShare: number | null;
  }>(q.sql, q.params);
  return rows
    .map(({ area, b, ...r }) => ({ id: area, ...bucketInfo(b, g), ...r }))
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
    arr: number | null; commune: string | null; date: string; type: string; address: string;
  }>(
    `SELECT id, lon, lat, price, surface, price_per_sqm AS "pricePerSqm", arr, commune,
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
    id: string; date: string; type: string; address: string; arr: number | null;
    commune: string | null; quartier: string | null; price: number; surface: number; pricePerSqm: number; rooms: number;
  }>(
    `SELECT id, sale_date AS "date", property_type AS "type", street AS "address", arr, commune,
      quartier, price, surface, price_per_sqm AS "pricePerSqm", rooms
    FROM sales WHERE ${where.sql}
    ORDER BY ${order} LIMIT $tLimit::INTEGER OFFSET $tOffset::INTEGER`,
    { ...where.params, tLimit: limit, tOffset: offset },
  );
  return { total: count!.total, items };
}
