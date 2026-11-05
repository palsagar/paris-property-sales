import { Router, type IRouter } from "express";
import {
  GetSalesSummaryQueryParams,
  GetSalesSummaryResponse,
  GetPriceDistributionQueryParams,
  GetPriceDistributionResponse,
  GetPricePerSqmDistributionQueryParams,
  GetPricePerSqmDistributionResponse,
  GetSalesTrendQueryParams,
  GetSalesTrendResponse,
  GetAreaTrendQueryParams,
  GetAreaTrendResponse,
  GetSalesByRoomsQueryParams,
  GetSalesByRoomsResponse,
  GetSalesByArrondissementQueryParams,
  GetSalesByArrondissementResponse,
  GetSalesByQuartierQueryParams,
  GetSalesByQuartierResponse,
  GetSalesPointsQueryParams,
  GetSalesPointsResponse,
  ListTransactionsQueryParams,
  ListTransactionsResponse,
} from "@workspace/api-zod";
import {
  arrondissementGeo,
  datasetMeta,
  datasetRange,
  filterSales,
  histogram,
  mean,
  median,
  percentile,
  quartierGeo,
  quartierNames,
  sortedValues2,
  type Sale,
  type SaleFilter,
} from "../lib/salesData";
import {
  bucketOrdinal,
  changeWindows,
  computeChange,
  groupByOrdinal,
  pooledBuckets,
  trendPoint,
} from "../lib/timeStats";

const router: IRouter = Router();

interface RangeQuery {
  propertyType?: string;
  arrondissement?: number;
  quartier?: string;
  from?: string;
  to?: string;
}

function toFilter(q: RangeQuery): SaleFilter {
  return {
    propertyType: q.propertyType,
    arrondissement: q.arrondissement,
    quartier: q.quartier,
    from: q.from,
    to: q.to,
  };
}

/** The selected range, falling back to the dataset coverage. */
function effectiveRange(q: RangeQuery): { from: string; to: string } {
  return {
    from: q.from && q.from > datasetRange.from ? q.from : datasetRange.from,
    to: q.to && q.to < datasetRange.to ? q.to : datasetRange.to,
  };
}

function areaStat(
  id: string,
  name: string,
  arrondissement: number,
  sales: Sale[],
  range: { from: string; to: string },
) {
  const ppsm = sortedValues2(sales.map((s) => s.pricePerSqm));
  const change = computeChange(sales, changeWindows(range.from, range.to));
  return {
    id,
    name,
    arrondissement,
    count: sales.length,
    medianPrice: median(sales.map((s) => s.price)),
    medianPricePerSqm: percentile(ppsm, 0.5),
    p25PricePerSqm: percentile(ppsm, 0.25),
    p75PricePerSqm: percentile(ppsm, 0.75),
    medianSurface: median(sales.map((s) => s.surface)),
    startMedianPricePerSqm: change.startMedianPricePerSqm,
    endMedianPricePerSqm: change.endMedianPricePerSqm,
    changePct: change.changePct,
  };
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

router.get("/sales/summary", (req, res): void => {
  const q = GetSalesSummaryQueryParams.parse(req.query);
  const sales = filterSales(toFilter(q));
  const range = effectiveRange(q);
  const prices = sales.map((s) => s.price);
  const ppsm = sales.map((s) => s.pricePerSqm);
  const change = computeChange(sales, changeWindows(range.from, range.to));
  const windows = changeWindows(range.from, range.to);
  res.json(
    GetSalesSummaryResponse.parse({
      count: sales.length,
      totalVolume: prices.reduce((a, b) => a + b, 0),
      medianPrice: median(prices),
      averagePrice: mean(prices),
      medianPricePerSqm: median(ppsm),
      averagePricePerSqm: mean(ppsm),
      medianSurface: median(sales.map((s) => s.surface)),
      minPrice: prices.length ? prices.reduce((m, v) => Math.min(m, v), Infinity) : 0,
      maxPrice: prices.reduce((m, v) => Math.max(m, v), 0),
      periodFrom: range.from,
      periodTo: range.to,
      datasetFrom: datasetRange.from,
      datasetTo: datasetRange.to,
      source: datasetMeta.source,
      excludedCount: datasetMeta.excludedCount,
      changeWindowMonths: windows?.months ?? 0,
      ...change,
    }),
  );
});

router.get("/sales/price-distribution", (req, res): void => {
  const q = GetPriceDistributionQueryParams.parse(req.query);
  const sales = filterSales(toFilter(q));
  res.json(
    GetPriceDistributionResponse.parse(
      histogram(
        sales.map((s) => s.price),
        45,
      ),
    ),
  );
});

router.get("/sales/price-per-sqm-distribution", (req, res): void => {
  const q = GetPricePerSqmDistributionQueryParams.parse(req.query);
  const sales = filterSales(toFilter(q));
  res.json(
    GetPricePerSqmDistributionResponse.parse(
      histogram(
        sales.map((s) => s.pricePerSqm),
        45,
      ),
    ),
  );
});

router.get("/sales/trend", (req, res): void => {
  const q = GetSalesTrendQueryParams.parse(req.query);
  const sales = filterSales(toFilter(q));
  const range = effectiveRange(q);
  const byOrdinal = groupByOrdinal(sales, q.granularity);
  const pooled = pooledBuckets(
    byOrdinal,
    bucketOrdinal(range.from, q.granularity),
    bucketOrdinal(range.to, q.granularity),
    q.window,
  );
  res.json(
    GetSalesTrendResponse.parse(
      pooled.map((p) => trendPoint(p.ordinal, q.granularity, p.sales)),
    ),
  );
});

router.get("/sales/area-trend", (req, res): void => {
  const q = GetAreaTrendQueryParams.parse(req.query);
  const sales = filterSales(toFilter(q));
  const range = effectiveRange(q);
  const first = bucketOrdinal(range.from, q.granularity);
  const last = bucketOrdinal(range.to, q.granularity);
  const byArea = groupBy(sales, (s) =>
    q.level === "quartier" ? (s.quartier ?? "") : String(s.arr),
  );
  const rows: Array<{
    id: string;
    period: string;
    label: string;
    count: number;
    medianPricePerSqm: number;
  }> = [];
  for (const [id, list] of byArea) {
    if (id === "") continue;
    const byOrdinal = groupByOrdinal(list, q.granularity);
    for (const p of pooledBuckets(byOrdinal, first, last, q.window)) {
      const point = trendPoint(p.ordinal, q.granularity, p.sales);
      rows.push({
        id,
        period: point.period,
        label: point.label,
        count: point.count,
        medianPricePerSqm: point.medianPricePerSqm,
      });
    }
  }
  rows.sort((a, b) =>
    a.period === b.period
      ? a.id.localeCompare(b.id, undefined, { numeric: true })
      : a.period.localeCompare(b.period),
  );
  res.json(GetAreaTrendResponse.parse(rows));
});

router.get("/sales/by-rooms", (req, res): void => {
  const q = GetSalesByRoomsQueryParams.parse(req.query);
  const sales = filterSales(toFilter(q)).filter((s) => s.rooms >= 1);
  const byRooms = groupBy(sales, (s) => Math.min(s.rooms, 5));
  const rows = [...byRooms.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rooms, list]) => ({
      rooms,
      count: list.length,
      medianPrice: median(list.map((s) => s.price)),
      medianPricePerSqm: median(list.map((s) => s.pricePerSqm)),
      medianSurface: median(list.map((s) => s.surface)),
    }));
  res.json(GetSalesByRoomsResponse.parse(rows));
});

router.get("/sales/by-arrondissement", (req, res): void => {
  const q = GetSalesByArrondissementQueryParams.parse(req.query);
  const sales = filterSales(toFilter(q));
  const range = effectiveRange(q);
  const byArr = groupBy(sales, (s) => s.arr);
  const names = new Map(
    arrondissementGeo.features.map((f) => [
      Number(f.properties["arr"]),
      String(f.properties["name"]),
    ]),
  );
  const rows = [...byArr.entries()]
    .sort(([a], [b]) => a - b)
    .map(([arr, list]) =>
      areaStat(String(arr), names.get(arr) ?? `${arr}`, arr, list, range),
    );
  res.json(GetSalesByArrondissementResponse.parse(rows));
});

router.get("/sales/by-quartier", (req, res): void => {
  const q = GetSalesByQuartierQueryParams.parse(req.query);
  const sales = filterSales(toFilter(q)).filter((s) => s.quartier !== null);
  const range = effectiveRange(q);
  const byQuartier = groupBy(sales, (s) => s.quartier as string);
  const rows = quartierGeo.features.flatMap((f) => {
    const id = String(f.properties["id"]);
    const list = byQuartier.get(id);
    if (!list) return [];
    return [
      areaStat(
        id,
        String(f.properties["name"]),
        Number(f.properties["arr"]),
        list,
        range,
      ),
    ];
  });
  res.json(GetSalesByQuartierResponse.parse(rows));
});

router.get("/sales/points", (req, res): void => {
  const q = GetSalesPointsQueryParams.parse(req.query);
  const rows = filterSales(toFilter(q)).flatMap((s) =>
    s.lon === null || s.lat === null
      ? []
      : [
          {
            id: s.id,
            lon: s.lon,
            lat: s.lat,
            price: s.price,
            surface: s.surface,
            pricePerSqm: s.pricePerSqm,
            arrondissement: s.arr,
            date: s.date,
            type: s.type,
            address: s.address,
          },
        ],
  );
  res.json(GetSalesPointsResponse.parse(rows));
});

const SORT_KEYS = {
  date: (s: Sale) => s.date,
  price: (s: Sale) => s.price,
  pricePerSqm: (s: Sale) => s.pricePerSqm,
  surface: (s: Sale) => s.surface,
} as const;

// Paging through a long list re-uses the same sorted order.
const sortedCache = new Map<string, Sale[]>();

router.get("/sales/transactions", (req, res): void => {
  const q = ListTransactionsQueryParams.parse(req.query);
  const sales = filterSales(toFilter(q));
  const pick = SORT_KEYS[q.sortBy];
  const dir = q.sortDir === "asc" ? 1 : -1;
  const sortKey = JSON.stringify([toFilter(q), q.sortBy, q.sortDir]);
  let sorted = sortedCache.get(sortKey);
  if (sorted) {
    sortedCache.delete(sortKey);
  } else {
    sorted = [...sales].sort((a, b) => {
      const av = pick(a);
      const bv = pick(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return a.id.localeCompare(b.id);
    });
  }
  sortedCache.set(sortKey, sorted);
  if (sortedCache.size > 6) {
    const oldest = sortedCache.keys().next();
    if (!oldest.done) sortedCache.delete(oldest.value);
  }
  const items = sorted.slice(q.offset, q.offset + q.limit).map((s) => ({
    id: s.id,
    date: s.date,
    type: s.type,
    address: s.address,
    arrondissement: s.arr,
    quartierName: s.quartier ? (quartierNames.get(s.quartier) ?? null) : null,
    price: s.price,
    surface: s.surface,
    pricePerSqm: s.pricePerSqm,
    rooms: s.rooms,
  }));
  res.json(ListTransactionsResponse.parse({ total: sorted.length, items }));
});

export default router;
