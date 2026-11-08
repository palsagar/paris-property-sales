import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import {
  useGetSalesSummary, getGetSalesSummaryQueryKey,
  useGetSalesByArrondissement, getGetSalesByArrondissementQueryKey,
  useGetSalesByCommune, getGetSalesByCommuneQueryKey,
  useGetAreaTrend, getGetAreaTrendQueryKey,
  useGetArrondissementBoundaries, useGetQuartierBoundaries, useGetCommuneBoundaries,
  type AreaStat, type AreaTrendPoint, type GranularityParameter, type YearRange,
} from "@workspace/api-client-react";
import { Sun, Moon, Printer, X, Link2, MoreHorizontal } from "lucide-react";
import { useViewState, viewQuery, type MapLevel, type MapMode, type ViewState } from "@/lib/view-state";
import { areaProps, openProps, track, type AreaVia } from "@/lib/analytics";
import { areaChange, areaParams, featureArea, groupOfArea, keepInSameArea, DEPARTMENT_NAMES, type Area, type DepartmentId, type MapFeature, type RankGroup } from "@/lib/areas";
import { useTheme } from "@/hooks/use-theme";
import { toast } from "@/hooks/use-toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { makeStepScale, quantileThresholds } from "@/lib/colour-scale";
import { arrLabel, rangeLabel, longMonthLabel, num, keep } from "@/lib/fmt";
import { areaStatParams, areaTrendParams, heatParams, parisSummaryParams, summaryParams, type PanelChoices } from "@/lib/selection-queries";
import { PanelChoicesContext, RequestedView, useShownView, type Patch } from "@/lib/shown-view";
import { FetchDot, Segmented, iconBtnCls, outlineBtnCls } from "@/components/ui-bits";
import { Kpis } from "@/components/kpis";
import { HeroTrend } from "@/components/hero-trend";
import { MapPanel } from "@/components/map-panel";
import { AreasCard } from "@/components/areas-card";
import { Distributions, RoomsChart } from "@/components/distributions";
import { Transactions } from "@/components/transactions";
import type { CommuneMeta, QMeta } from "@/components/area-picker";
import { SelectionBar } from "@/components/selection-bar";

const DATA_SOURCES = ["DVF open data (DGFiP)", "Paris OpenData boundaries", "Etalab Contours administratifs (ODbL)"];

// Wait for the dates: the first state of the view needs them to move an expired link.
export default function Dashboard() {
  const first = useGetSalesSummary({ propertyType: "all" });
  if (!first.data) {
    return first.isError ? (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center gap-3 bg-background text-[16px] px-6 text-center" data-testid="dashboard-error" role="alert">
        <p>The sales data did not load. Check your connection and try again.</p>
        <button onClick={() => first.refetch()} data-testid="button-retry" className={outlineBtnCls}>Try again</button>
      </div>
    ) : (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background text-[16px] text-muted-foreground" data-testid="dashboard-loading" role="status">Loading the sales data…</div>
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
  // The Quartiers and Communes, for the search box and for the names that analytics sends. The map loads the same
  // boundaries, so they are fetched once.
  const qB = useGetQuartierBoundaries();
  const communeB = useGetCommuneBoundaries();
  const quartiers: QMeta[] = useMemo(() => (qB.data?.features ?? []).map((f) => {
    const p = (f as { properties: { id: string; name: string; arr: number } }).properties;
    return { id: String(p.id), name: p.name, arr: p.arr };
  }).sort((a, b) => a.arr - b.arr || a.name.localeCompare(b.name)), [qB.data]);
  const communes: CommuneMeta[] = useMemo(() => (communeB.data?.features ?? []).map((f) => {
    const { id, name, group } = (f as { properties: { id: string; name: string; group: RankGroup } }).properties;
    return { id, name, group };
  }).sort((a, b) => a.name.localeCompare(b.name, "fr")), [communeB.data]);
  const names = useMemo(() => new Map([...quartiers, ...communes].map((x) => [x.id, x.name])), [quartiers, communes]);
  const viewRef = useRef(view);
  viewRef.current = view;
  const namesRef = useRef(names);
  namesRef.current = names;
  // A click on the selected Area clicks it off, back to Paris. While the page loads, the panels do not yet show the
  // requested Area as selected, so a second click on it does nothing. Refs keep selectArea stable.
  const updatingRef = useRef(updating);
  updatingRef.current = updating;
  const select = useCallback((a: Area, via: AreaVia, clickOff: boolean) => {
    const next = areaChange(viewRef.current.area, a, clickOff).area;
    if (next && JSON.stringify(next) !== JSON.stringify(viewRef.current.area)) track("select-area", { ...areaProps(next, namesRef.current), via });
    patch((s) => areaChange(s.area, a, clickOff));
  }, [patch]);
  const selectArea = useCallback((a: Area, via: AreaVia) => select(a, via, !updatingRef.current), [select]);
  const selectAreaOnly = useCallback((a: Area, via: AreaVia) => select(a, via, false), [select]);
  // The Selection a Visitor arrives with, once, when a link or bookmark carries settings. It waits for the Area's name.
  const firstView = useRef(view);
  const opened = useRef(false);
  const nameLoading = (firstView.current.area.kind === "q" && qB.isPending) || (firstView.current.area.kind === "commune" && communeB.isPending);
  useEffect(() => {
    if (opened.current || nameLoading) return;
    opened.current = true;
    if (viewQuery(firstView.current) !== "") track("open", openProps(firstView.current, names));
  }, [nameLoading, names]);
  const requested = useMemo(() => ({ view, patch, selectArea, updating }), [view, patch, selectArea, updating]);
  const panelChoices = useMemo(() => ({ choices, setChoices }), [choices]);
  return (
    <RequestedView.Provider value={requested}>
      <PanelChoicesContext.Provider value={panelChoices}>
        <DashboardView {...props} view={shown} requested={viewRef} patch={patch} selectArea={selectArea} selectAreaOnly={selectAreaOnly} movedTo={movedTo}
          quartiers={quartiers} communes={communes} />
      </PanelChoicesContext.Provider>
    </RequestedView.Provider>
  );
}

const DashboardView = memo(function DashboardView({ datasetFrom, datasetTo, releaseMonth, years, view, requested, patch, selectArea, selectAreaOnly, movedTo, quartiers, communes }: DatasetProps & {
  view: ViewState; requested: { readonly current: ViewState }; quartiers: QMeta[]; communes: CommuneMeta[]; patch: Patch; selectArea: (a: Area, via: AreaVia) => void; selectAreaOnly: (a: Area, via: AreaVia) => void; movedTo: { from?: string; to?: string } | null;
}) {
  const { ptype, area, from, to, mapMode, mapLevel, rank } = view;
  const { isDark, toggle: toggleTheme } = useTheme();
  const [travel, setTravel] = useState<string | null>(null);
  // On a phone the map and the list take turns; from a tablet up they sit side by side.
  const [compareTab, setCompareTab] = useState<"map" | "list">("map");

  useEffect(() => { setTravel(null); }, [from, to, ptype, mapLevel]);

  // Boundaries. ViewHost turns the Quartier and Commune boundaries into the lists of names.
  const arrB = useGetArrondissementBoundaries();
  const qB = useGetQuartierBoundaries();
  const qById = useMemo(() => new Map(quartiers.map((q) => [q.id, q])), [quartiers]);
  const communeB = useGetCommuneBoundaries();

  // The Selection keeps its identity when only the map, the trend's granularity or the ranking's group changes,
  // so the panels that read only the Selection do not redraw.
  const selection = useMemo(() => ({ ptype, area, from, to }), [ptype, area, from, to]);
  const filters = useMemo(() => summaryParams(selection), [selection]);
  const chartView = useMemo(() => ({ ptype, area }), [ptype, area]);
  const areaP = useMemo(() => areaParams(area), [area]);
  const selArr = area.kind === "arr" ? area.arr : area.kind === "q" ? qById.get(area.id)?.arr : undefined;

  const summary = useGetSalesSummary(filters, { query: { queryKey: getGetSalesSummaryQueryKey(filters), placeholderData: keepInSameArea(filters) } });
  // All Paris for the same type and Period, beside an Area's figures. selectionQueries loads it with the Selection.
  const parisP = useMemo(() => parisSummaryParams(selection), [selection]);
  const parisSummary = useGetSalesSummary(parisP, { query: { queryKey: getGetSalesSummaryQueryKey(parisP), enabled: area.kind !== "paris" } });
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

  const selectRow = useCallback((id: string) => selectArea(rank === "paris" ? { kind: "arr", arr: Number(id) } : { kind: "commune", id }, "heatmap"), [rank, selectArea]);
  // Stable callbacks, so the memoised panels redraw only when their data changes. An event records a change of the
  // requested view: while a view loads, the buttons show the shown view, and a click back to it is still a change.
  const setMode = useCallback((m: MapMode) => { if (requested.current.mapMode !== m) track("change-map-mode", { mode: m }); patch({ mapMode: m }); }, [patch, requested]);
  const setLevel = useCallback((l: MapLevel) => { if (requested.current.mapLevel !== l) track("change-map-level", { level: l }); patch({ mapLevel: l }); }, [patch, requested]);
  const setRank = useCallback((r: RankGroup) => { if (requested.current.rank !== r) track("change-ranking-group", { group: r }); patch({ rank: r }); }, [patch, requested]);
  const setGran = useCallback((g: GranularityParameter) => { if (requested.current.gran !== g) track("change-granularity", { gran: g }); patch({ gran: g }); }, [patch, requested]);
  const selectFeature = useCallback((p: MapFeature) => selectArea(featureArea(p), "map"), [selectArea]);
  const selectDot = useCallback((a: Area) => selectAreaOnly(a, "dot"), [selectAreaOnly]);
  const selectFromRanking = useCallback((a: Area) => selectArea(a, "ranking"), [selectArea]);
  const selectFromSales = useCallback((a: Area) => selectArea(a, "sales-list"), [selectArea]);
  const { refetch: refetchArr } = byArr, { refetch: refetchCommune } = byCommune, { refetch: refetchHeat } = heat;
  const retryStats = useCallback(() => { refetchArr(); refetchCommune(); }, [refetchArr, refetchCommune]);
  const retryHeat = useCallback(() => { refetchHeat(); refetchArr(); refetchCommune(); }, [refetchHeat, refetchArr, refetchCommune]);
  const selectQuartierName = useCallback((name: string) => { const q = quartiers.find((x) => x.name === name); if (q) selectArea({ kind: "q", id: q.id }, "sales-list"); }, [quartiers, selectArea]);
  const showTravel = useCallback((p: string) => { track("time-travel", { via: "heatmap-column" }); setTravel(p); patch({ mapMode: "level" }); }, [patch]);

  const communeGroup = groupOfArea(area);
  const areaName = area.kind === "department" ? DEPARTMENT_NAMES[area.id]
    : area.kind === "commune" ? communes.find((c) => c.id === area.id)?.name ?? "Commune"
    : area.kind === "arr" ? `${arrLabel(area.arr)} arrondissement`
    : area.kind === "q" ? qById.get(area.id)?.name ?? "Quartier" : "All Paris";
  const areaKicker = area.kind === "department" ? "Department"
    : area.kind === "commune" ? (communeB.data && !communes.some((c) => c.id === area.id) ? "" : communeGroup === "major" ? "Major town" : `Commune in ${DEPARTMENT_NAMES[communeGroup as DepartmentId]}`)
    // The Arrondissement's own name, such as Popincourt, so the heading matches the Selection bar's "11e arrondissement".
    : area.kind === "arr" ? arrStats.find((s) => s.arrondissement === area.arr)?.name ?? "Arrondissement" : area.kind === "q" ? `Quartier in the ${selArr ? arrLabel(selArr) : ""} arrondissement` : "";
  const typeLabel = ptype === "all" ? "all homes" : ptype === "Appartement" ? "apartments" : "houses";
  const scopeLabel = `${typeLabel}, ${areaName}, ${rangeLabel(ef, et)}`;
  const lastRefreshed = summary.dataUpdatedAt ? new Date(summary.dataUpdatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;

  const typeSentence = typeLabel[0].toUpperCase() + typeLabel.slice(1);
  const focusLine = keep(summary.data ? `${typeSentence}, ${rangeLabel(ef, et)}: ${num(summary.data.count)} sales.` : `${typeSentence}, ${rangeLabel(ef, et)}.`);
  // Where the Area sits: Paris > Arrondissement > Quartier, or Department > Commune. Each step selects that Area.
  const crumbs: { label: string; area?: Area }[] =
    area.kind === "arr" ? [{ label: "All Paris", area: { kind: "paris" } }, { label: areaName }]
    : area.kind === "q" ? [{ label: "All Paris", area: { kind: "paris" } }, ...(selArr ? [{ label: `${arrLabel(selArr)} arrondissement`, area: { kind: "arr", arr: selArr } as Area }] : []), { label: areaName }]
    : area.kind === "commune" && communeGroup !== "major" && communeGroup !== "paris" ? [{ label: DEPARTMENT_NAMES[communeGroup as DepartmentId], area: { kind: "department", id: communeGroup as DepartmentId } }, { label: areaName }]
    : [];

  const copyLink = useCallback(async () => {
    const url = window.location.href;
    // A phone offers its own share sheet; a laptop copies the link.
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      try { await navigator.share({ title: document.title, url }); track("copy-link", { via: "share" }); } catch { /* cancelled */ }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      track("copy-link", { via: "clipboard" });
      toast({ title: "Link copied", description: "It opens this exact view: area, type, period and panels." });
    } catch {
      toast({ title: "The link could not be copied", description: "Copy it from the address bar instead." });
    }
  }, []);
  const print = () => { track("print"); window.print(); };
  const flipTheme = () => { track("toggle-dark-mode", { on: !isDark }); toggleTheme(); };
  const showCompare = (v: "map" | "list") => { if (v !== compareTab) track("change-compare-view", { view: v }); setCompareTab(v); };

  return (
    <div className="relative z-[1] min-h-[100dvh] bg-background">
      <a href="#figures" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-50 focus:px-3 focus:py-2 focus:rounded-lg focus:bg-foreground focus:text-background">Skip to the figures</a>
      <div className="max-w-[1440px] mx-auto px-4 md:px-8">
        {/* Masthead: one line */}
        <header className="flex items-center justify-between gap-x-6 gap-y-2 border-b-2 border-foreground py-2 md:py-3">
          <div className="min-w-0 flex flex-wrap items-baseline gap-x-4">
            <p className="font-display font-bold text-[17px] md:text-[20px] leading-tight" data-testid="text-title">Paris &amp; Suburbs Property Sales</p>
            <p className="text-[13px] md:text-[14px] text-muted-foreground" data-testid="text-coverage">Data to {longMonthLabel(datasetTo)}<span className="hidden md:inline">, {longMonthLabel(releaseMonth)} release</span></p>
          </div>
          <div className="hidden md:flex items-center gap-2 print:hidden">
            <button type="button" onClick={copyLink} data-testid="button-copy-link" className={outlineBtnCls}><Link2 className="w-4 h-4" aria-hidden />Copy link to this view</button>
            <button type="button" onClick={print} data-testid="button-pdf" aria-label="Print or save as PDF" title="Print or save as PDF" className={iconBtnCls}><Printer className="w-[18px] h-[18px]" aria-hidden /></button>
            <button type="button" onClick={flipTheme} data-testid="button-theme" aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"} title={isDark ? "Light mode" : "Dark mode"} className={iconBtnCls}>
              {isDark ? <Sun className="w-[18px] h-[18px]" aria-hidden /> : <Moon className="w-[18px] h-[18px]" aria-hidden />}
            </button>
          </div>
          <div className="md:hidden print:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={iconBtnCls} aria-label="More: share, print, theme" data-testid="button-more"><MoreHorizontal className="w-5 h-5" aria-hidden /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[220px] rounded-xl p-1.5">
                <DropdownMenuItem onSelect={copyLink} className="min-h-11 text-[15px] gap-3"><Link2 className="w-4 h-4" aria-hidden />Share this view</DropdownMenuItem>
                <DropdownMenuItem onSelect={print} className="min-h-11 text-[15px] gap-3"><Printer className="w-4 h-4" aria-hidden />Print or save as PDF</DropdownMenuItem>
                <DropdownMenuItem onSelect={flipTheme} className="min-h-11 text-[15px] gap-3">{isDark ? <Sun className="w-4 h-4" aria-hidden /> : <Moon className="w-4 h-4" aria-hidden />}{isDark ? "Light mode" : "Dark mode"}</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Intro: scrolls away, the Selection bar below stays pinned */}
        <section className="pt-5 pb-5 md:pt-9 md:pb-7 flex flex-col gap-2.5" data-testid="intro">
          <h1 className="font-display font-bold text-[26px] md:text-[40px] leading-[1.12] max-w-[20em] text-balance" data-testid="text-headline">What homes in Paris and its suburbs have sold for since {longMonthLabel(datasetFrom)}, and where prices moved</h1>
          <p className="text-[16px] md:text-[18px] leading-relaxed text-muted-foreground max-w-[66ch] text-pretty">
            Every apartment and house sale recorded by the DGFiP, {longMonthLabel(datasetFrom)} to {longMonthLabel(datasetTo)}.
            <span className="hidden md:inline"> Choose an area, a property type and a period: every figure on the page follows your choice.</span>
          </p>
        </section>

        <SelectionBar chartView={chartView} datasetFrom={datasetFrom} datasetTo={datasetTo} years={years} isDark={isDark} quartiers={quartiers} communes={communes} qById={qById}
          count={summary.data?.count} />
        {movedTo && from === movedTo.from && to === movedTo.to && (
          <p className="mt-3 text-[14px] text-muted-foreground print:hidden" data-testid="period-moved-notice" role="status">
            The dates in this link are outside the latest DVF release, so the Period moved to {rangeLabel(ef, et)}.
          </p>
        )}

        <main id="figures" tabIndex={-1} className="outline-none">
          {/* The answer first: the focused Area and its key figures */}
          <section aria-labelledby="text-area-name" className="pt-6 md:pt-7" data-testid="focus-header">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0 flex flex-col gap-1.5">
                {crumbs.length > 0 && (
                  <nav aria-label="Where this area sits">
                    <ol className="flex flex-wrap items-center gap-x-1.5 text-[15px] md:text-[14px]">
                      {crumbs.map((c, i) => (
                        <li key={c.label} className="flex items-center gap-1.5">
                          {i > 0 && <span aria-hidden className="text-control">/</span>}
                          {c.area ? <button type="button" onClick={() => selectAreaOnly(c.area!, "back-link")} className="text-primary underline underline-offset-[3px] hover:opacity-80" data-testid={`crumb-${i}`}>{c.label}</button>
                            : <span aria-current="page" className="text-muted-foreground">{c.label}</span>}
                        </li>
                      ))}
                    </ol>
                  </nav>
                )}
                <h2 id="text-area-name" className="font-display font-bold text-[30px] md:text-[36px] leading-[1.1]" data-testid="text-area-name">{areaName}</h2>
                <p className="text-[16px] text-muted-foreground flex flex-wrap items-baseline gap-x-2">{areaKicker && `${areaKicker}. `}{focusLine}<FetchDot on={summary.isFetching && !summary.isLoading} /></p>
              </div>
              {area.kind !== "paris" && (
                <button type="button" onClick={() => selectArea({ kind: "paris" }, "back-link")} data-testid="button-clear-area" className={`${outlineBtnCls} print:hidden`}>
                  <X className="w-4 h-4" aria-hidden />Back to All Paris
                </button>
              )}
            </div>
            <div className="mt-4 md:mt-5">
              <Kpis s={summary.data} paris={area.kind !== "paris" ? parisSummary.data : undefined} ptype={ptype} loading={summary.isLoading} fetching={summary.isFetching} error={summary.isError} />
            </div>
          </section>

          {/* Then the comparison: map and list */}
          <section aria-labelledby="compare-title" className="pt-12 md:pt-14">
            <div className="flex flex-col gap-1 mb-4">
              <h2 id="compare-title" className="font-display font-bold text-[22px] md:text-[26px] leading-tight">Compare areas</h2>
              <p className="text-[16px] text-muted-foreground">Select an area on the map or in the list to focus the whole page on it.</p>
            </div>
            <Segmented role="tablist" label="Compare view" testId="compare-tab" value={compareTab} onChange={showCompare} stretch tall className="md:hidden mb-3"
              options={[["map", "Map"], ["list", "List"]]} />
            <div className="flex flex-wrap gap-4 items-start">
              <div className={`flex-[999_1_560px] min-w-0 ${compareTab === "map" ? "" : "hidden md:block"}`}>
                <MapPanel isDark={isDark} ptype={ptype} from={from} to={to} datasetFrom={datasetFrom} datasetTo={datasetTo}
                  area={area} selArr={selArr} areaParams={areaP} mode={mapMode} setMode={setMode}
                  level={mapLevel} setLevel={setLevel} arrStats={arrStats} communeStats={communeStats}
                  statsLoading={byArr.isLoading || byCommune.isLoading} statsError={byArr.isError || byCommune.isError}
                  retryStats={retryStats} arrTrend={arrTrend} communeTrend={communeTrend} trendFetching={arrTrendQ.isFetching || communeTrendQ.isFetching}
                  arrBounds={arrB.data} qBounds={qB.data} communeBounds={communeB.data} scale={scale}
                  travel={travel} setTravel={setTravel} onSelect={selectFeature} onSelectArea={selectDot} />
              </div>
              <div className={`flex-[1_1_480px] min-w-0 ${compareTab === "list" ? "" : "hidden md:block"}`}>
                <AreasCard rank={rank} onRank={setRank} stats={rankStats} trend={heatData} heatData={heatData} rows={rankRows}
                  loading={rankLoading} heatLoading={heat.isLoading || heat.isPlaceholderData || rankLoading}
                  fetching={byArr.isFetching || byCommune.isFetching || heat.isFetching} error={rankError} heatError={heat.isError || rankError}
                  retry={retryStats} retryHeat={retryHeat} scale={scale} domain={domain} selId={selId}
                  onSelect={selectFromRanking} onSelectRow={selectRow} ptype={ptype} travel={travel} onSelectPeriod={showTravel} isDark={isDark} />
              </div>
            </div>
          </section>

          <section className="pt-6">
            <HeroTrend selection={selection} gran={view.gran} areaName={areaName} setGran={setGran} isDark={isDark} years={years}
              summary={summary.data} paris={area.kind !== "paris" ? parisSummary.data : undefined} />
          </section>

          <section aria-labelledby="dist-title" className="pt-12 md:pt-14">
            <div className="flex flex-col gap-1 mb-4">
              <h2 id="dist-title" className="font-display font-bold text-[22px] md:text-[26px] leading-tight">What sold, and for how much</h2>
              <p className="text-[16px] text-muted-foreground">{summary.data ? `The spread of the ${num(summary.data.count)} sales in the Selection. ` : ""}Darker bars hold the middle half.</p>
            </div>
            <div className="flex flex-wrap gap-4">
              <Distributions filters={filters} houseShare={ptype === "all" ? summary.data?.houseShare : null} isDark={isDark} />
              <RoomsChart filters={filters} isDark={isDark} />
            </div>
          </section>

          <section className="pt-6">
            <Transactions selection={selection} scopeLabel={scopeLabel} areaName={areaName} scale={scale.color} areaColor={areaColor} isDark={isDark}
              onSelectArea={selectFromSales}
              onSelectQuartierName={selectQuartierName} />
          </section>
        </main>

        {/* About the data and the sources, once, at the end */}
        <footer className="mt-14 pb-12 border-t-2 border-foreground pt-6 flex flex-wrap gap-x-16 gap-y-6" data-testid="text-source-note">
          <section aria-labelledby="about-title" className="flex-[2_1_480px] max-w-[72ch] flex flex-col gap-2.5 text-[15px] leading-relaxed">
            <h2 id="about-title" className="font-display font-semibold text-[19px]">About the data</h2>
            <p className="font-medium">The figures describe past Sales. They are not a valuation of any home.</p>
            <p>They come from Demandes de valeurs foncières (DVF), published by the DGFiP, and cover residential sales in Paris and 135 Communes around it from {rangeLabel(datasetFrom, datasetTo)}. Prices are in nominal euros and are not adjusted for inflation. A Sale has one apartment or house, costs 20,000 to 20,000,000 EUR, has 9 to 300 m² of built surface and has a price of 1,000 to 35,000 EUR/m².</p>
            {noteSummary.current && <p>{num(noteSummary.current.excludedCount)} residential sales in the whole dataset are left out by these rules: sales of several properties at once, commercial premises and statistical outliers, which would distort the price per m².</p>}
            <p className="text-muted-foreground">A change compares the median of the first {noteSummary.current?.changeWindowMonths ?? 3} months of the Period with the median of the last {noteSummary.current?.changeWindowMonths ?? 3} months. Small areas and short periods give noisy figures, so periods with fewer than 10 sales are marked. A median based on fewer than 5 sales is not shown.</p>
          </section>
          <section aria-labelledby="sources-title" className="flex-[1_1_260px] flex flex-col gap-1.5 text-[14px] text-muted-foreground">
            <h2 id="sources-title" className="text-[14px] font-semibold text-foreground">Sources</h2>
            {DATA_SOURCES.map((d) => <p key={d}>{d}</p>)}
            <p>{longMonthLabel(releaseMonth)} release. Basemap tiles &copy; Esri.</p>
            {lastRefreshed && <p>Last loaded at {lastRefreshed}.</p>}
          </section>
        </footer>
      </div>
    </div>
  );
});
