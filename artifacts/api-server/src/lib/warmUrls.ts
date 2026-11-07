// The URLs the warm-up calls. This module does not import salesData.ts, which opens the data file at import time,
// so the tests can run without it.

const PAGE = 15;

function qs(params: Record<string, string | number>): string {
  return new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
}

/**
 * The requests of the default view of every Area: all dates, all property types, the map in Price level mode by
 * Arrondissement, the trend by quarter. They copy `selectionQueries` in the dashboard's `lib/selection-queries.ts`,
 * so a change to the params a panel sends needs a change here too. The shared requests come first.
 */
export function warmUrls(quartierIds: string[], communeIds: string[]): string[] {
  const all = { propertyType: "all" };
  const urls = [
    `/sales/by-arrondissement?${qs(all)}`,
    `/sales/by-commune?${qs(all)}`,
    ...(["arrondissement", "commune"] as const).flatMap((level) =>
      [1, 4].map((window) => `/sales/area-trend?${qs({ level, ...all, granularity: "quarter", window })}`)),
    // The All Paris line beside a Quartier's trend. Beside any other Area it is the Paris trend, warmed below.
    `/sales/trend?${qs({ ...all, granularity: "quarter", window: 3 })}`,
    "/geo/arrondissements",
    "/geo/quartiers",
    "/geo/communes",
  ];
  const areas: Record<string, string | number>[] = [
    {},
    ...Array.from({ length: 20 }, (_, i) => ({ arrondissement: i + 1 })),
    ...["92", "93", "94"].map((department) => ({ department })),
    ...quartierIds.map((quartier) => ({ quartier })),
    ...communeIds.map((commune) => ({ commune })),
  ];
  for (const area of areas) {
    const f = { ...all, ...area };
    urls.push(
      `/sales/summary?${qs(f)}`,
      `/sales/trend?${qs({ ...f, granularity: "month", window: 1 })}`,
      `/sales/trend?${qs({ ...f, granularity: "quarter", window: "quartier" in area ? 3 : 1 })}`,
      `/sales/price-distribution?${qs(f)}`,
      `/sales/price-per-sqm-distribution?${qs(f)}`,
      `/sales/by-rooms?${qs(f)}`,
      `/sales/transactions?${qs({ ...f, sortBy: "date", sortDir: "desc", limit: PAGE, offset: 0 })}`,
    );
  }
  return urls;
}
