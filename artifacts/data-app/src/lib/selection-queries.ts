import {
  getGetAreaTrendQueryOptions, getGetPriceDistributionQueryOptions, getGetPricePerSqmDistributionQueryOptions,
  getGetSalesByArrondissementQueryOptions, getGetSalesByCommuneQueryOptions, getGetSalesByQuartierQueryOptions,
  getGetSalesByRoomsQueryOptions, getGetSalesPointsQueryOptions, getGetSalesSummaryQueryOptions, getGetSalesTrendQueryOptions,
  getListTransactionsQueryOptions,
  type GetAreaTrendLevel, type GranularityParameter, type ListTransactionsSortBy, type ListTransactionsSortDir,
} from "@workspace/api-client-react";
import { areaParams } from "./areas";
import type { ViewState } from "./view-state";

/**
 * The requests of a view, in one place. The panels build their params with these functions and the page loads
 * `selectionQueries` before it shows a new view, so the params of the two always agree. The rule that decides whether
 * a panel makes a request at all is not shared: each panel has its own `enabled` rule, and `selectionQueries` writes
 * it again. Keep these in step by hand: the map's Quartier stats, Quartier trend and points (map level and mode, in
 * `map-panel.tsx`), the All Paris line beside an Area's trend (in `hero-trend.tsx`) and the All Paris figures beside
 * an Area's key figures (in `pages/dashboard.tsx`).
 */

/** A Visitor's Smoothing switch. It applies only to the granularity and Area level it was set on. */
export type SmoothChoice = { gran: GranularityParameter; isQuartier: boolean; on: boolean };
/** Panel settings that change requests but are not part of the link. */
export type PanelChoices = { smooth: SmoothChoice | null; sortBy: ListTransactionsSortBy; sortDir: ListTransactionsSortDir };

export const TRANSACTIONS_PAGE = 15;

/** The Smoothing window of the trend: 1 for a year, otherwise the Visitor's choice, else 3 for months or a Quartier. */
export function trendWindow(gran: GranularityParameter, isQuartier: boolean, smooth: SmoothChoice | null): 1 | 3 {
  if (gran === "year") return 1;
  if (smooth && smooth.gran === gran && smooth.isQuartier === isQuartier) return smooth.on ? 3 : 1;
  return gran === "month" || isQuartier ? 3 : 1;
}
export const smoothOn = (gran: GranularityParameter, isQuartier: boolean, smooth: SmoothChoice | null) => trendWindow(gran, isQuartier, smooth) === 3;

/** The parts of a view that most requests read. A panel can pass these alone, so it does not redraw when another part changes. */
export type Selection = Pick<ViewState, "ptype" | "area" | "from" | "to">;

const isQuartier = (v: Selection) => v.area.kind === "q";

/** The Selection: property type, Area and Period. Summary, distributions, rooms. */
export const summaryParams = (v: Selection) => ({ propertyType: v.ptype, ...areaParams(v.area), from: v.from, to: v.to });
/** Figures of every Arrondissement, Commune or Quartier: the Selection without its Area. */
export const areaStatParams = (v: Selection) => ({ propertyType: v.ptype, from: v.from, to: v.to });
export const quartierStatParams = areaStatParams;
export const areaTrendParams = (v: Selection, level: GetAreaTrendLevel, window: number) =>
  ({ level, ...areaStatParams(v), granularity: "quarter" as const, window });
export const heatParams = (v: Selection & Pick<ViewState, "rank">) => areaTrendParams(v, v.rank === "paris" ? "arrondissement" : "commune", 1);
export const quartierTrendParams = (v: Selection) => areaTrendParams(v, "quartier", 4);
export const pointParams = summaryParams;
/** The small chart of the time slider: the whole range, so it does not depend on the Period. */
export const timeTrendParams = (v: Pick<ViewState, "ptype" | "area">) => ({ propertyType: v.ptype, ...areaParams(v.area), granularity: "month" as const, window: 1 });
export const trendParams = (v: Selection & Pick<ViewState, "gran">, c: PanelChoices) =>
  ({ ...summaryParams(v), granularity: v.gran, window: trendWindow(v.gran, isQuartier(v), c.smooth) });
/** The All Paris figures beside an Area's key figures: the Selection's type and Period, with no Area. */
export const parisSummaryParams = (v: Selection) => summaryParams({ ...v, area: { kind: "paris" } });
/** The All Paris line beside an Area's trend. */
export const parisTrendParams = (v: Selection & Pick<ViewState, "gran">, c: PanelChoices) =>
  ({ ...areaStatParams(v), granularity: v.gran, window: trendWindow(v.gran, isQuartier(v), c.smooth) });
export const transactionParams = (v: Selection, c: PanelChoices, offset: number) =>
  ({ ...summaryParams(v), sortBy: c.sortBy, sortDir: c.sortDir, limit: TRANSACTIONS_PAGE, offset });

/** The query options of exactly the requests that the panels of this view make. */
export function selectionQueries(v: ViewState, c: PanelChoices) {
  const s = summaryParams(v), a = areaStatParams(v);
  const out: { queryKey: readonly unknown[] }[] = [
    getGetSalesSummaryQueryOptions(s),
    getGetSalesByArrondissementQueryOptions(a),
    getGetSalesByCommuneQueryOptions(a),
    getGetAreaTrendQueryOptions(areaTrendParams(v, "arrondissement", 4)),
    getGetAreaTrendQueryOptions(areaTrendParams(v, "commune", 4)),
    getGetAreaTrendQueryOptions(heatParams(v)),
    getGetSalesTrendQueryOptions(timeTrendParams(v)),
    getGetSalesTrendQueryOptions(trendParams(v, c)),
    getGetPriceDistributionQueryOptions(s),
    getGetPricePerSqmDistributionQueryOptions(s),
    getGetSalesByRoomsQueryOptions(s),
    getListTransactionsQueryOptions(transactionParams(v, c, 0)),
  ];
  if (v.area.kind !== "paris") {
    out.push(getGetSalesTrendQueryOptions(parisTrendParams(v, c)));
    out.push(getGetSalesSummaryQueryOptions(parisSummaryParams(v)));
  }
  if (v.mapLevel === "quartier" && v.mapMode !== "dots") out.push(getGetSalesByQuartierQueryOptions(quartierStatParams(v)));
  if (v.mapLevel === "quartier" && v.mapMode === "level") out.push(getGetAreaTrendQueryOptions(quartierTrendParams(v)));
  if (v.mapMode === "dots") out.push(getGetSalesPointsQueryOptions(pointParams(v)));
  return out;
}
