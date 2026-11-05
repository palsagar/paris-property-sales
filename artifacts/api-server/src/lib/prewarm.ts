import { logger } from "./logger";
import { datasetRange, quartierNames } from "./salesData";

const PAGE = 15;
const TYPES = ["all", "Appartement", "Maison"] as const;

function lastTwelveMonths(): { from: string; to: string } {
  const to = datasetRange.to;
  const d = new Date(`${to}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 11, 1);
  return { from: d.toISOString().slice(0, 10), to };
}

type Range = { from?: string; to?: string };

function ranges(): Range[] {
  const years = [2022, 2023, 2024, 2025, 2026].map((y) => ({
    from: `${y}-01-01`,
    to: `${y}-12-31`,
  }));
  return [{}, ...years, lastTwelveMonths()];
}

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.set(k, String(v));
  }
  return u.toString();
}

/**
 * URLs the dashboard requests when the visitor switches slice. Ordered by
 * likelihood so that the default views are warm first.
 */
function* warmUrls(): Generator<string> {
  const areas: Array<Record<string, string | number>> = [
    {},
    ...Array.from({ length: 20 }, (_, i) => ({ arrondissement: i + 1 })),
  ];
  const quartiers = [...quartierNames.keys()].map((id) => ({ quartier: id }));

  const areaIndependent = (propertyType: string, r: Range): string[] => {
    const base = { propertyType, ...r };
    return [
      `/sales/by-arrondissement?${qs(base)}`,
      `/sales/by-quartier?${qs(base)}`,
      `/sales/area-trend?${qs({ level: "arrondissement", ...base, granularity: "quarter", window: 1 })}`,
      `/sales/area-trend?${qs({ level: "arrondissement", ...base, granularity: "quarter", window: 4 })}`,
      `/sales/area-trend?${qs({ level: "quartier", ...base, granularity: "quarter", window: 4 })}`,
    ];
  };

  const areaDependent = (
    propertyType: string,
    r: Range,
    area: Record<string, string | number>,
    withTrends: boolean,
  ): string[] => {
    const f = { propertyType, ...area, ...r };
    const urls = [
      `/sales/summary?${qs(f)}`,
      `/sales/price-distribution?${qs(f)}`,
      `/sales/price-per-sqm-distribution?${qs(f)}`,
      `/sales/by-rooms?${qs(f)}`,
      `/sales/transactions?${qs({ ...f, sortBy: "date", sortDir: "desc", limit: PAGE, offset: 0 })}`,
    ];
    if (withTrends) {
      for (const [granularity, window] of [
        ["quarter", 1],
        ["quarter", 3],
        ["month", 3],
        ["year", 1],
      ] as const) {
        urls.push(`/sales/trend?${qs({ ...f, granularity, window })}`);
      }
    }
    return urls;
  };

  // 1. Default range, every property type.
  for (const t of TYPES) {
    yield* areaIndependent(t, {});
    yield `/sales/trend?${qs({ propertyType: t, granularity: "month", window: 1 })}`;
    for (const a of areas) {
      yield* areaDependent(t, {}, a, true);
      if (a["arrondissement"] !== undefined) {
        yield `/sales/trend?${qs({ propertyType: t, ...a, granularity: "month", window: 1 })}`;
      }
    }
  }
  // 2. Quartiers (default range, all property types).
  for (const q of quartiers) {
    yield* areaDependent("all", {}, q, true);
    yield `/sales/trend?${qs({ propertyType: "all", ...q, granularity: "month", window: 1 })}`;
  }
  // 3. Presets (one year, last 12 months) for Paris and arrondissements.
  for (const r of ranges().slice(1)) {
    yield* areaIndependent("all", r);
    for (const a of areas) yield* areaDependent("all", r, a, true);
  }
  // 4. Dots map for the default window and each arrondissement.
  const recent = lastTwelveMonths();
  yield `/sales/points?${qs({ propertyType: "all", ...recent })}`;
}

export async function prewarm(port: number): Promise<void> {
  const started = Date.now();
  let count = 0;
  let failed = 0;
  for (const url of warmUrls()) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api${url}`, {
        headers: { "Accept-Encoding": "identity" },
      });
      await res.arrayBuffer();
      if (!res.ok) failed += 1;
    } catch {
      failed += 1;
    }
    count += 1;
    // Yield so that real visitors are served between warm-up requests.
    await new Promise((r) => setTimeout(r, 2));
  }
  logger.info(
    { count, failed, ms: Date.now() - started },
    "Response cache warmed",
  );
}
