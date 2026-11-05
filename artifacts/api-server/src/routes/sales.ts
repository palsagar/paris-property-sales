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
  quartierGeo,
  quartierNames,
  salesDb,
} from "../lib/salesData";
import {
  areaStats,
  areaTrendPoints,
  distribution,
  salePoints,
  salesByRooms,
  summaryStats,
  transactionPage,
  trendPoints,
  type SaleFilter,
} from "../lib/salesQueries";
import { bucketOrdinal, changeWindows } from "../lib/timeStats";

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

router.get("/sales/summary", async (req, res): Promise<void> => {
  const q = GetSalesSummaryQueryParams.parse(req.query);
  const range = effectiveRange(q);
  const windows = changeWindows(range.from, range.to);
  const stats = await summaryStats(salesDb, toFilter(q), windows);
  res.json(
    GetSalesSummaryResponse.parse({
      ...stats,
      periodFrom: range.from,
      periodTo: range.to,
      datasetFrom: datasetRange.from,
      datasetTo: datasetRange.to,
      source: datasetMeta.source,
      excludedCount: datasetMeta.excludedCount,
      changeWindowMonths: windows?.months ?? 0,
    }),
  );
});

router.get("/sales/price-distribution", async (req, res): Promise<void> => {
  const q = GetPriceDistributionQueryParams.parse(req.query);
  res.json(
    GetPriceDistributionResponse.parse(
      await distribution(salesDb, toFilter(q), "price", 45),
    ),
  );
});

router.get("/sales/price-per-sqm-distribution", async (req, res): Promise<void> => {
  const q = GetPricePerSqmDistributionQueryParams.parse(req.query);
  res.json(
    GetPricePerSqmDistributionResponse.parse(
      await distribution(salesDb, toFilter(q), "price_per_sqm", 45),
    ),
  );
});

router.get("/sales/trend", async (req, res): Promise<void> => {
  const q = GetSalesTrendQueryParams.parse(req.query);
  const range = effectiveRange(q);
  res.json(
    GetSalesTrendResponse.parse(
      await trendPoints(
        salesDb,
        toFilter(q),
        q.granularity,
        q.window,
        bucketOrdinal(range.from, q.granularity),
        bucketOrdinal(range.to, q.granularity),
      ),
    ),
  );
});

router.get("/sales/area-trend", async (req, res): Promise<void> => {
  const q = GetAreaTrendQueryParams.parse(req.query);
  const range = effectiveRange(q);
  res.json(
    GetAreaTrendResponse.parse(
      await areaTrendPoints(
        salesDb,
        toFilter(q),
        q.level,
        q.granularity,
        q.window,
        bucketOrdinal(range.from, q.granularity),
        bucketOrdinal(range.to, q.granularity),
      ),
    ),
  );
});

router.get("/sales/by-rooms", async (req, res): Promise<void> => {
  const q = GetSalesByRoomsQueryParams.parse(req.query);
  res.json(GetSalesByRoomsResponse.parse(await salesByRooms(salesDb, toFilter(q))));
});

router.get("/sales/by-arrondissement", async (req, res): Promise<void> => {
  const q = GetSalesByArrondissementQueryParams.parse(req.query);
  const range = effectiveRange(q);
  const stats = await areaStats(
    salesDb,
    toFilter(q),
    "arrondissement",
    changeWindows(range.from, range.to),
  );
  const names = new Map(
    arrondissementGeo.features.map((f) => [
      Number(f.properties["arr"]),
      String(f.properties["name"]),
    ]),
  );
  const rows = stats.map(({ area, ...stat }) => {
    const arr = Number(area);
    return { id: area, name: names.get(arr) ?? area, arrondissement: arr, ...stat };
  });
  res.json(GetSalesByArrondissementResponse.parse(rows));
});

router.get("/sales/by-quartier", async (req, res): Promise<void> => {
  const q = GetSalesByQuartierQueryParams.parse(req.query);
  const range = effectiveRange(q);
  const stats = await areaStats(
    salesDb,
    toFilter(q),
    "quartier",
    changeWindows(range.from, range.to),
  );
  const byQuartier = new Map(stats.map((s) => [s.area, s]));
  const rows = quartierGeo.features.flatMap((f) => {
    const id = String(f.properties["id"]);
    const found = byQuartier.get(id);
    if (!found) return [];
    const { area: _area, ...stat } = found;
    return [
      {
        id,
        name: String(f.properties["name"]),
        arrondissement: Number(f.properties["arr"]),
        ...stat,
      },
    ];
  });
  res.json(GetSalesByQuartierResponse.parse(rows));
});

router.get("/sales/points", async (req, res): Promise<void> => {
  const q = GetSalesPointsQueryParams.parse(req.query);
  res.json(GetSalesPointsResponse.parse(await salePoints(salesDb, toFilter(q))));
});

router.get("/sales/transactions", async (req, res): Promise<void> => {
  const q = ListTransactionsQueryParams.parse(req.query);
  const { total, items } = await transactionPage(
    salesDb,
    toFilter(q),
    q.sortBy,
    q.sortDir,
    q.limit,
    q.offset,
  );
  res.json(
    ListTransactionsResponse.parse({
      total,
      items: items.map(({ quartier, ...item }) => ({
        ...item,
        quartierName: quartier ? (quartierNames.get(quartier) ?? null) : null,
      })),
    }),
  );
});

export default router;
