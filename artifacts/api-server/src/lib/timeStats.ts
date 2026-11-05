import type { SqlParams } from "./salesDb";

export type Granularity = "month" | "quarter" | "year";

const MIN_SALES_FOR_CHANGE = 5;

function parts(date: string): { y: number; m: number; d: number } {
  return {
    y: Number(date.slice(0, 4)),
    m: Number(date.slice(5, 7)),
    d: Number(date.slice(8, 10)),
  };
}

/** Ordinal index of the time bucket a date falls in (monotonic over time). */
export function bucketOrdinal(date: string, g: Granularity): number {
  const { y, m } = parts(date);
  if (g === "month") return y * 12 + (m - 1);
  if (g === "quarter") return y * 4 + Math.floor((m - 1) / 3);
  return y;
}

/** SQL for the same ordinal as bucketOrdinal(), over the text column sale_date (YYYY-MM-DD). */
export function ordinalSql(g: Granularity): string {
  const y = "cast(substr(sale_date, 1, 4) AS INTEGER)";
  const m = "cast(substr(sale_date, 6, 2) AS INTEGER)";
  if (g === "month") return `(${y} * 12 + (${m} - 1))`;
  if (g === "quarter") return `(${y} * 4 + (${m} - 1) // 3)`;
  return y;
}

/** First day (YYYY-MM-DD) and label of a bucket. */
export function bucketInfo(
  ordinal: number,
  g: Granularity,
): { period: string; label: string } {
  if (g === "month") {
    const y = Math.floor(ordinal / 12);
    const m = (ordinal % 12) + 1;
    const mm = String(m).padStart(2, "0");
    return { period: `${y}-${mm}-01`, label: `${y}-${mm}` };
  }
  if (g === "quarter") {
    const y = Math.floor(ordinal / 4);
    const q = ordinal % 4;
    const mm = String(q * 3 + 1).padStart(2, "0");
    return { period: `${y}-${mm}-01`, label: `${y} Q${q + 1}` };
  }
  return { period: `${ordinal}-01-01`, label: String(ordinal) };
}

function addMonthsIso(date: string, months: number): string {
  const { y, m, d } = parts(date);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const dd = Math.min(d, lastDay);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export interface ChangeWindows {
  months: number;
  startEnd: string; // exclusive upper bound of the start window
  endStart: string; // exclusive lower bound of the end window
}

/**
 * The start and end windows each cover half of the range, up to 12 months.
 * Returns null when the range is shorter than 2 months.
 */
export function changeWindows(from: string, to: string): ChangeWindows | null {
  const a = parts(from);
  const b = parts(to);
  const months = (b.y * 12 + b.m) - (a.y * 12 + a.m) + 1;
  const n = Math.min(12, Math.floor(months / 2));
  if (n < 1) return null;
  return {
    months: n,
    startEnd: addMonthsIso(from, n),
    endStart: addMonthsIso(to, -n),
  };
}

export interface Change {
  startMedianPricePerSqm: number | null;
  endMedianPricePerSqm: number | null;
  changePct: number | null;
  startMedianPrice: number | null;
  endMedianPrice: number | null;
  priceChangePct: number | null;
}

export interface ChangeRow {
  nStart: number;
  nEnd: number;
  startPpsm: number | null;
  endPpsm: number | null;
  startPrice: number | null;
  endPrice: number | null;
}

/** SQL columns for the Change figures, for use in a SELECT over `sales` (the start and end windows from changeWindows). */
export function changeSelect(w: ChangeWindows | null): { sql: string; params: SqlParams } {
  if (!w) {
    return {
      sql: "0::INTEGER AS nStart, 0::INTEGER AS nEnd, NULL::DOUBLE AS startPpsm, NULL::DOUBLE AS endPpsm, NULL::DOUBLE AS startPrice, NULL::DOUBLE AS endPrice",
      params: {},
    };
  }
  const start = "sale_date < $cwStartEnd";
  const end = "sale_date > $cwEndStart";
  return {
    sql: `count(*) FILTER (WHERE ${start})::INTEGER AS nStart,
      count(*) FILTER (WHERE ${end})::INTEGER AS nEnd,
      quantile_cont(price_per_sqm, 0.5) FILTER (WHERE ${start})::DOUBLE AS startPpsm,
      quantile_cont(price_per_sqm, 0.5) FILTER (WHERE ${end})::DOUBLE AS endPpsm,
      quantile_cont(price, 0.5) FILTER (WHERE ${start})::DOUBLE AS startPrice,
      quantile_cont(price, 0.5) FILTER (WHERE ${end})::DOUBLE AS endPrice`,
    params: { cwStartEnd: w.startEnd, cwEndStart: w.endStart },
  };
}

export function changeFromRow(row: ChangeRow): Change {
  if (
    row.nStart < MIN_SALES_FOR_CHANGE ||
    row.nEnd < MIN_SALES_FOR_CHANGE ||
    row.startPpsm === null || row.endPpsm === null ||
    row.startPrice === null || row.endPrice === null
  ) {
    return {
      startMedianPricePerSqm: null,
      endMedianPricePerSqm: null,
      changePct: null,
      startMedianPrice: null,
      endMedianPrice: null,
      priceChangePct: null,
    };
  }
  return {
    startMedianPricePerSqm: row.startPpsm,
    endMedianPricePerSqm: row.endPpsm,
    changePct: ((row.endPpsm - row.startPpsm) / row.startPpsm) * 100,
    startMedianPrice: row.startPrice,
    endMedianPrice: row.endPrice,
    priceChangePct: ((row.endPrice - row.startPrice) / row.startPrice) * 100,
  };
}
