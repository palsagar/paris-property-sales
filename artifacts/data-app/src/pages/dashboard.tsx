import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import {
  useGetSalesSummary, getGetSalesSummaryQueryKey,
  useGetSalesByArrondissement, getGetSalesByArrondissementQueryKey,
  useGetSalesByCommune, getGetSalesByCommuneQueryKey,
  useGetAreaTrend, getGetAreaTrendQueryKey,
  useGetArrondissementBoundaries, useGetQuartierBoundaries, useGetCommuneBoundaries,
  type AreaStat, type AreaTrendPoint, type GranularityParameter, type YearRange,
} from "@workspace/api-client-react";
import { Sun, Moon, Printer, X, Info, MapPin } from "lucide-react";
import { useViewState, type MapLevel, type MapMode, type ViewState } from "@/lib/view-state";
import { areaChange, areaParams, featureArea, groupOfArea, keepInSameArea, DEPARTMENT_NAMES, type Area, type DepartmentId, type MapFeature, type RankGroup } from "@/lib/areas";
import { makeStepScale, quantileThresholds } from "@/lib/colour-scale";
import { arrLabel, rangeLabel, longMonthLabel, num, sqmOrTooFew, pct, houseShareLabel } from "@/lib/fmt";
import { areaStatParams, areaTrendParams, heatParams, summaryParams, type PanelChoices } from "@/lib/selection-queries";
import { PanelChoicesContext, RequestedView, useShownView, type Patch } from "@/lib/shown-view";
import { btnCls, FetchDot } from "@/components/ui-bits";
import { Kpis } from "@/components/kpis";
import { HeroTrend } from "@/components/hero-trend";
import { MapPanel } from "@/components/map-panel";
import { Ranking } from "@/components/ranking";
import { Heatmap } from "@/components/heatmap";
import { Distributions, RoomsChart } from "@/components/distributions";
import { Transactions } from "@/components/transactions";
import type { QMeta } from "@/components/area-picker";
import { FilterBar } from "@/components/filter-bar";
import { RefreshControl } from "@/components/refresh-control";

const DATA_SOURCES = ["DVF open data (DGFiP)", "Paris OpenData boundaries", "Etalab Contours administratifs (ODbL)"];

// Wait for the dates: the first state of the view needs them to move an expired link.
export default function Dashboard() {
  const first = useGetSalesSummary({ propertyType: "all" });
  if (!first.data) {
    return first.isError ? (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-background text-[14px]" data-testid="dashboard-error">
        <p>The sales data did not load.</p>
        <button onClick={() => first.refetch()} data-testid="button-retry" className={`h-8 px-3 rounded-md ${btnCls}`}>Try again</button>
      </div>
    ) : (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background text-[14px] text-muted-foreground" data-testid="dashboard-loading">Loading the sales data...</div>
    );
  }
  const { datasetFrom, datasetTo, releaseMonth, years } = first.data;
  return <ViewHost datasetFrom={datasetFrom} datasetTo={datasetTo} releaseMonth={releaseMonth} years={years} />;
}

type DatasetProps = { datasetFrom: string; datasetTo: string; releaseMonth: string; years: YearRange[] };

/** Owns the requested view and the panel choices, and shows the dashboard for the view whose data has loaded. */
function ViewHost(props: DatasetProps) {
  const [view, patch, movedTo] = useViewState(props.datasetFrom, props.datasetTo);
  const [choices, setChoices] = useState<PanelChoices>({ smooth: null, sortBy: "date", sortDir: "desc" });
  const { shown, updating } = useShownView(view, choices);
  // A click on the selected Area clicks it off, back to Paris.
  const selectArea = useCallback((a: Area) => patch((s) => areaChange(s.area, a)), [patch]);
  const selectAreaOnly = useCallback((a: Area) => patch((s) => areaChange(s.area, a, false)), [patch]);
  const requested = useMemo(() => ({ view, patch, selectArea, updating }), [view, patch, selectArea, updating]);
  const panelChoices = useMemo(() => ({ choices, setChoices }), [choices]);
  return (
    <RequestedView.Provider value={requested}>
      <PanelChoicesContext.Provider value={panelChoices}>
        <DashboardView {...props} view={shown} patch={patch} selectArea={selectArea} selectAreaOnly={selectAreaOnly} movedTo={movedTo} />
      </PanelChoicesContext.Provider>
    </RequestedView.Provider>
  );
}

const DashboardView = memo(function DashboardView({ datasetFrom, datasetTo, releaseMonth, years, view, patch, selectArea, selectAreaOnly, movedTo }: DatasetProps & {
  view: ViewState; patch: Patch; selectArea: (a: Area) => void; selectAreaOnly: (a: Area) => void; movedTo: { from?: string; to?: string } | null;
}) {
  const { ptype, area, from, to, mapMode, mapLevel, rank } = view;
  const [isDark, setIsDark] = useState(false);
  const [travel, setTravel] = useState<string | null>(null);

  useEffect(() => { document.documentElement.classList.toggle("dark", isDark); }, [isDark]);
  useEffect(() => { setTravel(null); }, [from, to, ptype, mapLevel]);

  // Boundaries (also provide quartier names for the picker)
  const arrB = useGetArrondissementBoundaries();
  const qB = useGetQuartierBoundaries();
  const quartiers: QMeta[] = useMemo(() => (qB.data?.features ?? []).map((f) => {
    const p = (f as { properties: { id: string; name: string; arr: number } }).properties;
    return { id: String(p.id), name: p.name, arr: p.arr };
  }).sort((a, b) => a.arr - b.arr || a.name.localeCompare(b.name)), [qB.data]);
  const qById = useMemo(() => new Map(quartiers.map((q) => [q.id, q])), [quartiers]);
  const communeB = useGetCommuneBoundaries();
  const communes = useMemo(() => (communeB.data?.features ?? []).map((f) => {
    const { id, name, group } = (f as { properties: { id: string; name: string; group: RankGroup } }).properties;
    return { id, name, group };
  }).sort((a, b) => a.name.localeCompare(b.name, "fr")), [communeB.data]);

  // The Selection keeps its identity when only the map, the trend's granularity or the ranking's group changes,
  // so the panels that read only the Selection do not redraw.
  const selection = useMemo(() => ({ ptype, area, from, to }), [ptype, area, from, to]);
  const filters = useMemo(() => summaryParams(selection), [selection]);
  const chartView = useMemo(() => ({ ptype, area }), [ptype, area]);
  const areaP = useMemo(() => areaParams(area), [area]);
  const selArr = area.kind === "arr" ? area.arr : area.kind === "q" ? qById.get(area.id)?.arr : undefined;

  const summary = useGetSalesSummary(filters, { query: { queryKey: getGetSalesSummaryQueryKey(filters), placeholderData: keepInSameArea(filters) } });
  // The data note's figures do not depend on the Area, so the note keeps the last summary while a new Area loads.
  const noteSummary = useRef(summary.data);
  if (summary.data) noteSummary.current = summary.data;
  const ap = areaStatParams(selection);
  const byArr = useGetSalesByArrondissement(ap, { query: { queryKey: getGetSalesByArrondissementQueryKey(ap) } });
  const byCommune = useGetSalesByCommune(ap, { query: { queryKey: getGetSalesByCommuneQueryKey(ap) } });
  // The colour scale reads these two whatever the map shows, so they always load.
  const arrTrendP = areaTrendParams(selection, "arrondissement", 4);
  const arrTrendQ = useGetAreaTrend(arrTrendP, { query: { queryKey: getGetAreaTrendQueryKey(arrTrendP) } });
  const communeTrendP = areaTrendParams(selection, "commune", 4);
  const communeTrendQ = useGetAreaTrend(communeTrendP, { query: { queryKey: getGetAreaTrendQueryKey(communeTrendP) } });
  const hp = heatParams(view);
  const heat = useGetAreaTrend(hp, { query: { queryKey: getGetAreaTrendQueryKey(hp) } });

  const ef = from ?? datasetFrom, et = to ?? datasetTo;

  const arrStats = useMemo(() => byArr.data ?? [], [byArr.data]);
  const communeStats = useMemo(() => byCommune.data ?? [], [byCommune.data]);
  const arrTrend = useMemo(() => arrTrendQ.data ?? [], [arrTrendQ.data]);
  const communeTrend = useMemo(() => communeTrendQ.data ?? [], [communeTrendQ.data]);
  // The rows of the ranking and the heat map: Paris, or the Communes of one Department or of the Major towns.
  const rankStats = useMemo(() => (rank === "paris" ? arrStats : communeStats.filter((s) => s.group === rank)), [rank, arrStats, communeStats]);
  const rankRows = useMemo(() => {
    const sorted = rank === "paris" ? [...rankStats].sort((a, b) => (a.arrondissement ?? 0) - (b.arrondissement ?? 0)) : [...rankStats].sort((a, b) => a.name.localeCompare(b.name, "fr"));
    return sorted.map((s) => ({ id: s.id, label: s.arrondissement != null ? arrLabel(s.arrondissement) : s.name }));
  }, [rank, rankStats]);
  const heatData = useMemo(() => {
    const ids = new Set(rankRows.map((r) => r.id));
    return (heat.data ?? []).filter((r) => ids.has(r.id));
  }, [heat.data, rankRows]);
  const rankLoading = rank === "paris" ? byArr.isLoading : byCommune.isLoading;
  const rankError = rank === "paris" ? byArr.isError : byCommune.isError;
  const selId = area.kind === "commune" ? area.id : selArr != null ? String(selArr) : undefined;
  // One price scale for the whole range: map, time travel, ranking, heat map. Quartiers do not enter it,
  // so switching the map level keeps the colours.
  const scale = useMemo(() => {
    const figures = (stats: AreaStat[], trend: AreaTrendPoint[]) => [
      ...stats.map((s) => s.medianPricePerSqm),
      ...trend.filter((r) => r.count >= 10).map((r) => r.medianPricePerSqm),
    ].filter((v): v is number => v != null);
    return makeStepScale(quantileThresholds(figures(arrStats, arrTrend), figures(communeStats, communeTrend)));
  }, [arrStats, arrTrend, communeStats, communeTrend]);
  const domain = useMemo<[number, number]>(() => [scale.thresholds[0] ?? 0, scale.thresholds[scale.thresholds.length - 1] ?? 0], [scale]);
  const areaMedians = useMemo(() => new Map([...arrStats, ...communeStats].map((s) => [s.id, s.medianPricePerSqm])), [arrStats, communeStats]);
  const areaColor = useCallback((id: string) => {
    const m = areaMedians.get(id);
    return m == null ? "transparent" : scale.color(m);
  }, [areaMedians, scale]);

  const selectRow = useCallback((id: string) => selectArea(rank === "paris" ? { kind: "arr", arr: Number(id) } : { kind: "commune", id }), [rank, selectArea]);
  // Stable callbacks, so the memoised panels redraw only when their data changes.
  const setMode = useCallback((m: MapMode) => patch({ mapMode: m }), [patch]);
  const setLevel = useCallback((l: MapLevel) => patch({ mapLevel: l }), [patch]);
  const setRank = useCallback((r: RankGroup) => patch({ rank: r }), [patch]);
  const setGran = useCallback((g: GranularityParameter) => patch({ gran: g }), [patch]);
  const selectFeature = useCallback((p: MapFeature) => selectArea(featureArea(p)), [selectArea]);
  const { refetch: refetchArr } = byArr, { refetch: refetchCommune } = byCommune, { refetch: refetchHeat } = heat;
  const retryStats = useCallback(() => { refetchArr(); refetchCommune(); }, [refetchArr, refetchCommune]);
  const retryHeat = useCallback(() => { refetchHeat(); refetchArr(); refetchCommune(); }, [refetchHeat, refetchArr, refetchCommune]);
  const selectQuartierName = useCallback((name: string) => { const q = quartiers.find((x) => x.name === name); if (q) selectArea({ kind: "q", id: q.id }); }, [quartiers, selectArea]);
  const showTravel = useCallback((p: string) => { setTravel(p); patch({ mapMode: "level" }); }, [patch]);

  const communeGroup = groupOfArea(area);
  const areaName = area.kind === "department" ? DEPARTMENT_NAMES[area.id]
    : area.kind === "commune" ? communes.find((c) => c.id === area.id)?.name ?? "Commune"
    : area.kind === "arr" ? arrStats.find((s) => s.arrondissement === area.arr)?.name ?? `${arrLabel(area.arr)} arrondissement`
    : area.kind === "q" ? qById.get(area.id)?.name ?? "Quartier" : "All Paris";
  const areaKicker = area.kind === "department" ? "Department"
    : area.kind === "commune" ? (communeB.data && !communes.some((c) => c.id === area.id) ? "" : communeGroup === "major" ? "Major town" : `Commune in ${DEPARTMENT_NAMES[communeGroup as DepartmentId]}`)
    : area.kind === "arr" ? "Arrondissement" : area.kind === "q" ? `Quartier in the ${selArr ? arrLabel(selArr) : ""} arrondissement` : "";
  const typeLabel = ptype === "all" ? "all homes" : ptype === "Appartement" ? "apartments" : "houses";
  const scopeLabel = `${typeLabel}, ${areaName}, ${rangeLabel(ef, et)}`;
  const lastRefreshed = summary.dataUpdatedAt ? new Date(summary.dataUpdatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;

  // A Selection of one type says nothing through its House share, and with no median there is nothing to note.
  const introShare = ptype === "all" && summary.data?.medianPricePerSqm != null ? houseShareLabel(summary.data.houseShare) : null;

  const typeSentence = typeLabel[0].toUpperCase() + typeLabel.slice(1);
  const focusLine = summary.data ? `${typeSentence}, ${rangeLabel(ef, et)}: ${num(summary.data.count)} sales.` : `${typeSentence}, ${rangeLabel(ef, et)}.`;

  return (
    <div className="relative z-[1] min-h-[100dvh] bg-background px-4 md:px-6 py-3 md:py-4">
      <div className="max-w-[1480px] mx-auto">
        {/* Masthead: one line */}
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b-2 border-foreground pb-2">
          <div className="flex flex-wrap items-baseline gap-x-4">
            <div className="font-display font-bold text-[20px] leading-tight" data-testid="text-title">Paris & Suburbs Property Sales</div>
            <div className="text-[13px] text-muted-foreground" data-testid="text-coverage">Data to {longMonthLabel(datasetTo)}, {longMonthLabel(releaseMonth)} release</div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <RefreshControl />
            <button onClick={() => window.print()} data-testid="button-pdf" aria-label="Print or save as PDF" title="Print or save as PDF" className={`flex items-center justify-center w-8 h-8 rounded-md ${btnCls}`}><Printer className="w-3.5 h-3.5" /></button>
            <button onClick={() => setIsDark((d) => !d)} data-testid="button-theme" aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"} className={`flex items-center justify-center w-8 h-8 rounded-md ${btnCls}`}>{isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}</button>
          </div>
        </header>

        {/* Intro band: scrolls away, the filter bar below stays sticky */}
        <section className="py-3 md:py-4 border-b flex flex-wrap items-end justify-between gap-x-8 gap-y-3" data-testid="intro">
          <div className="max-w-[760px]">
            <h1 className="font-display font-bold text-[24px] md:text-[32px] leading-[1.1]" data-testid="text-headline">What homes in Paris and its suburbs have sold for since {longMonthLabel(datasetFrom)}, and where prices moved</h1>
            <p className="mt-1.5 text-[14px] md:text-[15px] text-muted-foreground leading-snug">
              Apartment and house sales from the DGFiP's Demandes de valeurs foncières, from {longMonthLabel(datasetFrom)} to {longMonthLabel(datasetTo)}, the latest official release.
              <span className="hidden md:inline"> Pick a period, a property type or an area, or click the map to drill down.</span>
            </p>
          </div>
          {summary.data && (
            <div className="hidden xl:block text-right" data-testid="intro-figures">
              <p className="text-[13px] font-medium mb-1" data-testid="text-intro-area">Figures for {areaName}</p>
              <dl className="flex gap-8">
                <div><dt className="text-[13px] text-muted-foreground">Sales</dt><dd className="font-display font-bold text-[22px] text-primary">{num(summary.data.count)}</dd></div>
                <div><dt className="text-[13px] text-muted-foreground">Median per m²</dt><dd className="font-display font-bold text-[22px] text-primary">{sqmOrTooFew(summary.data.medianPricePerSqm)}</dd>{introShare && <dd className="text-[12.5px] text-muted-foreground" data-testid="text-intro-house-share">{introShare}</dd>}</div>
                <div><dt className="text-[13px] text-muted-foreground">Change over the period</dt><dd className="font-display font-bold text-[22px] text-primary">{summary.data.changePct != null ? pct(summary.data.changePct) : "n/a"}</dd></div>
              </dl>
            </div>
          )}
        </section>

        {/* Sticky filters: time, property type, area */}
        <FilterBar chartView={chartView} datasetFrom={datasetFrom} datasetTo={datasetTo} years={years} isDark={isDark} quartiers={quartiers} communes={communes} qById={qById} />
        {movedTo && from === movedTo.from && to === movedTo.to && (
          <p className="mb-3 text-[13px] text-muted-foreground print:hidden" data-testid="period-moved-notice">
            The dates in this link are outside the latest DVF release, so the Period moved to {rangeLabel(ef, et)}.
          </p>
        )}

        <main>
          {/* Map first */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_520px] gap-4 mb-5">
            <MapPanel isDark={isDark} ptype={ptype} from={from} to={to} datasetFrom={datasetFrom} datasetTo={datasetTo}
              area={area} selArr={selArr} areaParams={areaP} mode={mapMode} setMode={setMode}
              level={mapLevel} setLevel={setLevel} arrStats={arrStats} communeStats={communeStats}
              statsLoading={byArr.isLoading || byCommune.isLoading} statsError={byArr.isError || byCommune.isError}
              retryStats={retryStats} arrTrend={arrTrend} communeTrend={communeTrend} trendFetching={arrTrendQ.isFetching || communeTrendQ.isFetching}
              arrBounds={arrB.data} qBounds={qB.data} communeBounds={communeB.data} scale={scale}
              travel={travel} setTravel={setTravel} onSelect={selectFeature} onSelectArea={selectAreaOnly} />
            <Ranking stats={rankStats} trend={heatData} loading={rankLoading} fetching={byArr.isFetching || byCommune.isFetching || heat.isFetching} error={rankError}
              retry={retryStats} scale={scale} selId={selId} onSelect={selectArea}
              rank={rank} onRank={setRank} ptype={ptype} isDark={isDark} />
          </div>

          {/* Focus header */}
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3" data-testid="focus-header">
            <div>
              <h2 className="font-display font-bold text-[26px] leading-tight flex items-center gap-2" data-testid="text-area-name"><MapPin className="w-5 h-5 text-primary" aria-hidden />{areaName}</h2>
              <p className="text-[14px] text-muted-foreground flex flex-wrap items-baseline gap-x-2">{areaKicker && `${areaKicker}. `}{focusLine}<FetchDot on={summary.isFetching && !summary.isLoading} /></p>
            </div>
            {area.kind !== "paris" && (
              <button onClick={() => selectArea({ kind: "paris" })} data-testid="button-clear-area"
                className="h-8 px-3 rounded-md border border-primary/40 text-primary text-[13px] flex items-center gap-1.5 hover:bg-primary/5 transition-colors print:hidden">
                <X className="w-3.5 h-3.5" />Back to All Paris
              </button>
            )}
          </div>

          <Kpis s={summary.data} ptype={ptype} loading={summary.isLoading} fetching={summary.isFetching} error={summary.isError} />

          <div className="mb-4">
            <HeroTrend selection={selection} gran={view.gran} areaName={areaName} setGran={setGran} isDark={isDark} years={years} />
          </div>

          <div className="mb-4">
            <Heatmap data={heatData} rows={rankRows} loading={heat.isLoading || heat.isPlaceholderData || rankLoading} fetching={heat.isFetching} error={heat.isError || rankError} retry={retryHeat}
              scale={scale.color} domain={domain} selId={selId} onSelectRow={selectRow} rank={rank} onRank={setRank} ptype={ptype} travel={travel}
              onSelectPeriod={showTravel} isDark={isDark} />
          </div>

          <Distributions filters={filters} houseShare={ptype === "all" ? summary.data?.houseShare : null} isDark={isDark} />

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4 mb-4">
            <RoomsChart filters={filters} isDark={isDark} />
            <section className="flex items-start gap-3 rounded-lg border bg-card px-5 py-4 text-[14px] leading-relaxed" data-testid="text-source-note">
              <Info className="w-4 h-4 text-primary shrink-0 mt-1" aria-hidden />
              <div className="space-y-2 max-w-[68ch]">
                <h2 className="font-display font-bold text-[17px]">About the data</h2>
                <p>The figures come from Demandes de valeurs foncières (DVF), published by the DGFiP. They cover residential sales in Paris and 135 Communes around it from {rangeLabel(datasetFrom, datasetTo)}, the latest official release. Prices are in nominal euros and are not adjusted for inflation. A Sale has one apartment or house, costs 20,000 to 20,000,000 EUR, has 9 to 300 m² of built surface and has a price of 1,000 to 35,000 EUR/m².</p>
                {noteSummary.current && <p>{num(noteSummary.current.excludedCount)} residential transactions in the whole dataset are left out by these rules. They are sales of several properties at once, commercial premises and statistical outliers, which would distort the price per m².</p>}
                <p className="text-muted-foreground">Changes compare the median of the first {noteSummary.current?.changeWindowMonths ?? 3} months of the selected period with the median of the last {noteSummary.current?.changeWindowMonths ?? 3} months. Small areas and short periods give noisy figures, so periods with fewer than 10 sales are marked. A median based on fewer than 5 sales is not shown.</p>
                <p className="text-muted-foreground">Sources: {DATA_SOURCES.join(", ")}.{lastRefreshed && ` Last loaded at ${lastRefreshed}.`}</p>
              </div>
            </section>
          </div>

          <Transactions selection={selection} scopeLabel={scopeLabel} scale={scale.color} areaColor={areaColor} isDark={isDark}
            onSelectArea={selectArea}
            onSelectQuartierName={selectQuartierName} />
        </main>

        <footer className="mt-6 pt-4 border-t text-[13px] text-muted-foreground flex flex-wrap justify-between gap-2">
          <span>Source: DVF, Direction générale des Finances publiques. {rangeLabel(datasetFrom, datasetTo)}, {longMonthLabel(releaseMonth)} release. Nominal euros.</span>
          <span>Basemap tiles &copy; Esri.</span>
        </footer>
      </div>
    </div>
  );
});
