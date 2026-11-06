import { useState, useEffect, useMemo, useRef } from "react";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import {
  useGetSalesSummary, getGetSalesSummaryQueryKey,
  useGetSalesByArrondissement, getGetSalesByArrondissementQueryKey,
  useGetAreaTrend, getGetAreaTrendQueryKey,
  useGetArrondissementBoundaries, useGetQuartierBoundaries,
  type PropertyTypeParameter, type YearRange,
} from "@workspace/api-client-react";
import { RefreshCw, ChevronDown, Check, Sun, Moon, Printer, X, Info, MapPin } from "lucide-react";
import { useViewState, type MapLevel } from "@/lib/view-state";
import { makeScale, arrLabel, rangeLabel, longMonthLabel, quantile, num, sqm, pct } from "@/lib/fmt";
import { btnCls, FetchDot } from "@/components/ui-bits";
import { TimeControl } from "@/components/time-control";
import { Kpis } from "@/components/kpis";
import { HeroTrend, type Filters } from "@/components/hero-trend";
import { MapPanel } from "@/components/map-panel";
import { Ranking } from "@/components/ranking";
import { Heatmap } from "@/components/heatmap";
import { Distributions, RoomsChart } from "@/components/distributions";
import { Transactions } from "@/components/transactions";
import { QuartierPicker, type QMeta } from "@/components/area-picker";
import type { FeatureProps } from "@/components/sales-map";

const INTERVAL_OPTIONS = [
  { label: "Every 5 min", ms: 5 * 60 * 1000 },
  { label: "Every 15 min", ms: 15 * 60 * 1000 },
  { label: "Every 1 hour", ms: 60 * 60 * 1000 },
  { label: "Every 24 hours", ms: 24 * 60 * 60 * 1000 },
];
const DATA_SOURCES = ["DVF open data (DGFiP)", "Paris OpenData boundaries"];

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
  return <DashboardView datasetFrom={datasetFrom} datasetTo={datasetTo} releaseMonth={releaseMonth} years={years} />;
}

function DashboardView({ datasetFrom, datasetTo, releaseMonth, years }: { datasetFrom: string; datasetTo: string; releaseMonth: string; years: YearRange[] }) {
  const qc = useQueryClient();
  const [view, patch, movedTo] = useViewState(datasetFrom, datasetTo);
  const { ptype, area, from, to, mapMode, mapLevel, gran } = view;
  const [isDark, setIsDark] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [intervalMs, setIntervalMs] = useState(5 * 60 * 1000);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [travel, setTravel] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.documentElement.classList.toggle("dark", isDark); }, [isDark]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => qc.invalidateQueries(), Math.max(intervalMs, 5 * 60 * 1000));
    return () => clearInterval(t);
  }, [autoRefresh, intervalMs, qc]);
  useEffect(() => { setTravel(null); }, [from, to, ptype, mapLevel]);

  // Boundaries (also provide quartier names for the picker)
  const arrB = useGetArrondissementBoundaries();
  const qB = useGetQuartierBoundaries();
  const quartiers: QMeta[] = useMemo(() => (qB.data?.features ?? []).map((f) => {
    const p = (f as { properties: { id: string; name: string; arr: number } }).properties;
    return { id: String(p.id), name: p.name, arr: p.arr };
  }).sort((a, b) => a.arr - b.arr || a.name.localeCompare(b.name)), [qB.data]);
  const qById = useMemo(() => new Map(quartiers.map((q) => [q.id, q])), [quartiers]);

  const areaParams = area.kind === "arr" ? { arrondissement: area.arr } : area.kind === "q" ? { quartier: area.id } : {};
  const filters: Filters = { propertyType: ptype, ...areaParams, from, to };
  const selArr = area.kind === "arr" ? area.arr : area.kind === "q" ? qById.get(area.id)?.arr : undefined;

  const summary = useGetSalesSummary(filters, { query: { queryKey: getGetSalesSummaryQueryKey(filters) } });
  const ap = { propertyType: ptype, from, to };
  const byArr = useGetSalesByArrondissement(ap, { query: { queryKey: getGetSalesByArrondissementQueryKey(ap) } });
  const hp = { level: "arrondissement" as const, propertyType: ptype, from, to, granularity: "quarter" as const, window: 1 };
  const heat = useGetAreaTrend(hp, { query: { queryKey: getGetAreaTrendQueryKey(hp) } });

  const ef = from ?? datasetFrom, et = to ?? datasetTo;

  const fetchingCount = useIsFetching();
  useEffect(() => {
    if (fetchingCount > 0) { setIsSpinning(true); return; }
    const t = setTimeout(() => setIsSpinning(false), 600);
    return () => clearTimeout(t);
  }, [fetchingCount]);

  const arrStats = useMemo(() => byArr.data ?? [], [byArr.data]);
  const heatData = useMemo(() => heat.data ?? [], [heat.data]);
  // One fixed price scale for the whole range: map, time travel, ranking, heat map.
  const domain = useMemo<[number, number]>(() => {
    const v = [...heatData.filter((r) => r.count >= 10).map((r) => r.medianPricePerSqm), ...arrStats.map((s) => s.medianPricePerSqm)].sort((a, b) => a - b);
    if (!v.length) return [8000, 16000];
    return [Math.floor(quantile(v, 0.02) / 500) * 500, Math.ceil(quantile(v, 0.98) / 500) * 500];
  }, [heatData, arrStats]);
  const scale = useMemo(() => makeScale(domain[0], domain[1]), [domain]);
  const arrColor = (a: number) => scale(arrStats.find((s) => s.arrondissement === a)?.medianPricePerSqm ?? 0);

  const selectArr = (a?: number) => patch({ area: a && !(area.kind === "arr" && area.arr === a) ? { kind: "arr", arr: a } : { kind: "all" } });
  const selectQ = (id: string) => patch({ area: area.kind === "q" && area.id === id ? { kind: "all" } : { kind: "q", id } });
  const onMapSelect = (p: FeatureProps, level: MapLevel) => (level === "quartier" && p.id ? selectQ(String(p.id)) : selectArr(p.arr));

  const areaName = area.kind === "arr" ? arrStats.find((s) => s.arrondissement === area.arr)?.name ?? `${arrLabel(area.arr)} arrondissement`
    : area.kind === "q" ? qById.get(area.id)?.name ?? "Quartier" : "All Paris";
  const areaKicker = area.kind === "arr" ? "Arrondissement" : area.kind === "q" ? `Quartier in the ${selArr ? arrLabel(selArr) : ""} arrondissement` : "";
  const typeLabel = ptype === "all" ? "all homes" : ptype === "Appartement" ? "apartments" : "houses";
  const scopeLabel = `${typeLabel}, ${areaName}, ${rangeLabel(ef, et)}`;
  const lastRefreshed = summary.dataUpdatedAt ? new Date(summary.dataUpdatedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : null;

  const typeSentence = typeLabel[0].toUpperCase() + typeLabel.slice(1);
  const focusLine = summary.data ? `${typeSentence}, ${rangeLabel(ef, et)}: ${num(summary.data.count)} sales.` : `${typeSentence}, ${rangeLabel(ef, et)}.`;

  return (
    <div className="relative z-[1] min-h-[100dvh] bg-background px-4 md:px-6 py-3 md:py-4">
      <div className="max-w-[1480px] mx-auto">
        {/* Masthead: one line */}
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b-2 border-foreground pb-2">
          <div className="flex flex-wrap items-baseline gap-x-4">
            <div className="font-display font-bold text-[20px] leading-tight" data-testid="text-title">Paris Property Sales</div>
            <div className="text-[13px] text-muted-foreground" data-testid="text-coverage">Data to {longMonthLabel(datasetTo)}, {longMonthLabel(releaseMonth)} release</div>
          </div>
          <div className="flex items-center gap-2 print:hidden">
            <div className="relative" ref={dropdownRef}>
              <div className={`flex items-center rounded-md overflow-hidden h-8 text-[13px] ${btnCls}`}>
                <button onClick={() => qc.invalidateQueries()} disabled={fetchingCount > 0} data-testid="button-refresh" className="flex items-center gap-1.5 px-2.5 h-full hover:bg-foreground/5 transition-colors disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${isSpinning ? "animate-spin" : ""}`} />{autoRefresh ? "Refresh (auto)" : "Refresh"}
                </button>
                <div className="w-px h-4 bg-border" />
                <button onClick={() => setDropdownOpen((o) => !o)} data-testid="button-refresh-menu" aria-label="Auto-refresh options" aria-expanded={dropdownOpen} className="flex items-center px-1.5 h-full hover:bg-foreground/5 transition-colors">
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
                </button>
              </div>
              {dropdownOpen && (
                <div className="absolute right-0 mt-1.5 w-[210px] z-[1000] rounded-lg border bg-popover p-1.5 text-[13px] shadow-[0_12px_32px_-12px_hsl(var(--foreground)/0.35)]">
                  <button onClick={() => setAutoRefresh((a) => !a)} data-testid="toggle-auto-refresh" aria-pressed={autoRefresh} className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted">
                    Auto-refresh
                    <span className={`w-7 h-4 rounded-full relative transition-colors ${autoRefresh ? "bg-primary" : "bg-muted-foreground/30"}`}>
                      <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-background transition-transform ${autoRefresh ? "translate-x-3" : ""}`} />
                    </span>
                  </button>
                  <div className="h-px bg-border my-1" />
                  {INTERVAL_OPTIONS.map((o) => (
                    <button key={o.ms} disabled={!autoRefresh} onClick={() => setIntervalMs(o.ms)} className="w-full flex items-center justify-between px-2 py-1.5 rounded hover:bg-muted disabled:opacity-40">
                      {o.label}{intervalMs === o.ms && <Check className="w-3.5 h-3.5 text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => window.print()} data-testid="button-pdf" aria-label="Print or save as PDF" title="Print or save as PDF" className={`flex items-center justify-center w-8 h-8 rounded-md ${btnCls}`}><Printer className="w-3.5 h-3.5" /></button>
            <button onClick={() => setIsDark((d) => !d)} data-testid="button-theme" aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"} className={`flex items-center justify-center w-8 h-8 rounded-md ${btnCls}`}>{isDark ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}</button>
          </div>
        </header>

        {/* Intro band: scrolls away, the filter bar below stays sticky */}
        <section className="py-3 md:py-4 border-b flex flex-wrap items-end justify-between gap-x-8 gap-y-3" data-testid="intro">
          <div className="max-w-[760px]">
            <h1 className="font-display font-bold text-[24px] md:text-[32px] leading-[1.1]" data-testid="text-headline">What homes in Paris have sold for since {longMonthLabel(datasetFrom)}, and where prices moved</h1>
            <p className="mt-1.5 text-[14px] md:text-[15px] text-muted-foreground leading-snug">
              Every recorded apartment and house sale from the DGFiP's Demandes de valeurs foncières, from {longMonthLabel(datasetFrom)} to {longMonthLabel(datasetTo)}, the latest official release.
              <span className="hidden md:inline"> Pick a period, a property type or an area, or click the map to drill down.</span>
            </p>
          </div>
          {summary.data && (
            <dl className="hidden xl:flex gap-8 text-right" data-testid="intro-figures">
              <div><dt className="text-[13px] text-muted-foreground">Sales</dt><dd className="font-display font-bold text-[22px] text-primary">{num(summary.data.count)}</dd></div>
              <div><dt className="text-[13px] text-muted-foreground">Median per m²</dt><dd className="font-display font-bold text-[22px] text-primary">{sqm(summary.data.medianPricePerSqm)}</dd></div>
              <div><dt className="text-[13px] text-muted-foreground">Change over the period</dt><dd className="font-display font-bold text-[22px] text-primary">{summary.data.changePct != null ? pct(summary.data.changePct) : "n/a"}</dd></div>
            </dl>
          )}
        </section>

        {/* Sticky filters: time, property type, area */}
        <div className="md:sticky top-0 z-[500] -mx-4 md:-mx-6 px-4 md:px-6 py-2 mb-3 bg-background border-b space-y-2 print:static">
          <TimeControl ptype={ptype} areaParams={areaParams} from={from} to={to} datasetFrom={datasetFrom} datasetTo={datasetTo} years={years}
            onChange={(f, t) => patch({ from: f, to: t })} isDark={isDark} />
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-muted-foreground">Property</span>
              <div className="flex rounded-md border bg-card p-0.5" role="group" aria-label="Property type">
                {([["all", "All"], ["Appartement", "Apartments"], ["Maison", "Houses"]] as [PropertyTypeParameter, string][]).map(([v, l]) => (
                  <button key={v} onClick={() => patch({ ptype: v })} data-testid={`filter-type-${v}`} aria-pressed={ptype === v}
                    className={`px-3 h-7 text-[13px] rounded transition-colors ${ptype === v ? "bg-foreground text-background" : "hover:bg-muted"}`}>{l}</button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 min-w-0 flex-wrap">
              <span className="text-[13px] text-muted-foreground">Area</span>
              <div className="flex flex-wrap gap-0.5" role="group" aria-label="Arrondissement">
                <button onClick={() => patch({ area: { kind: "all" } })} data-testid="filter-arr-all" aria-pressed={area.kind === "all"} className={`px-2 h-7 text-[13px] rounded transition-colors ${area.kind === "all" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>Paris</button>
                {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                  <button key={n} onClick={() => selectArr(n)} data-testid={`filter-arr-${n}`} aria-pressed={area.kind === "arr" && area.arr === n} aria-label={`${arrLabel(n)} arrondissement`}
                    className={`w-7 h-7 text-[12.5px] font-num rounded transition-colors ${area.kind === "arr" && area.arr === n ? "bg-primary text-primary-foreground" : selArr === n ? "ring-1 ring-primary text-primary" : "hover:bg-muted"}`}>{n}</button>
                ))}
              </div>
              <QuartierPicker quartiers={quartiers} selected={area.kind === "q" ? area.id : undefined} onSelect={(q) => patch({ area: { kind: "q", id: q.id } })} />
            </div>
          </div>
        </div>
        {movedTo && from === movedTo.from && to === movedTo.to && (
          <p className="mb-3 text-[13px] text-muted-foreground print:hidden" data-testid="period-moved-notice">
            The dates in this link are outside the latest DVF release, so the Period moved to {rangeLabel(ef, et)}.
          </p>
        )}

        <main>
          {/* Map first */}
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-4 mb-5">
            <MapPanel isDark={isDark} ptype={ptype} from={from} to={to} datasetFrom={datasetFrom} datasetTo={datasetTo}
              area={area} selArr={selArr} areaParams={areaParams} mode={mapMode} setMode={(m) => patch({ mapMode: m })}
              level={mapLevel} setLevel={(l) => patch({ mapLevel: l })} arrStats={arrStats} arrLoading={byArr.isLoading} arrError={byArr.isError}
              retryArr={() => byArr.refetch()} arrBounds={arrB.data} qBounds={qB.data} scale={scale} domain={domain}
              travel={travel} setTravel={setTravel} onSelect={onMapSelect} />
            <Ranking stats={arrStats} trend={heatData} loading={byArr.isLoading} fetching={byArr.isFetching || heat.isFetching} error={byArr.isError}
              retry={() => byArr.refetch()} scale={scale} domain={domain} selArr={selArr} onSelect={(a) => selectArr(a)} isDark={isDark} />
          </div>

          {/* Focus header */}
          <div className="flex flex-wrap items-end justify-between gap-3 mb-3" data-testid="focus-header">
            <div>
              <h2 className="font-display font-bold text-[26px] leading-tight flex items-center gap-2" data-testid="text-area-name"><MapPin className="w-5 h-5 text-primary" aria-hidden />{areaName}</h2>
              <p className="text-[14px] text-muted-foreground flex flex-wrap items-baseline gap-x-2">{area.kind !== "all" && `${areaKicker}. `}{focusLine}<FetchDot on={summary.isFetching && !summary.isLoading} /></p>
            </div>
            {area.kind !== "all" && (
              <button onClick={() => patch({ area: { kind: "all" } })} data-testid="button-clear-area"
                className="h-8 px-3 rounded-md border border-primary/40 text-primary text-[13px] flex items-center gap-1.5 hover:bg-primary/5 transition-colors print:hidden">
                <X className="w-3.5 h-3.5" />Back to All Paris
              </button>
            )}
          </div>

          <Kpis s={summary.data} loading={summary.isLoading} fetching={summary.isFetching} error={summary.isError} />

          <div className="mb-4">
            <HeroTrend filters={filters} areaName={areaName} hasArea={area.kind !== "all"} isQuartier={area.kind === "q"} gran={gran} setGran={(g) => patch({ gran: g })} isDark={isDark} />
          </div>

          <div className="mb-4">
            <Heatmap data={heatData} loading={heat.isLoading} fetching={heat.isFetching} error={heat.isError} retry={() => heat.refetch()}
              scale={scale} domain={domain} selArr={selArr} onSelectArr={(a) => selectArr(a)} travel={travel}
              onSelectPeriod={(p) => { setTravel(p); patch({ mapMode: "level" }); }} isDark={isDark} />
          </div>

          <Distributions filters={filters} isDark={isDark} />

          <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-4 mb-4">
            <RoomsChart filters={filters} isDark={isDark} />
            <section className="flex items-start gap-3 rounded-lg border bg-card px-5 py-4 text-[14px] leading-relaxed" data-testid="text-source-note">
              <Info className="w-4 h-4 text-primary shrink-0 mt-1" aria-hidden />
              <div className="space-y-2 max-w-[68ch]">
                <h2 className="font-display font-bold text-[17px]">About the data</h2>
                <p>The figures come from Demandes de valeurs foncières (DVF), published by the DGFiP. They cover every residential sale signed in Paris from {rangeLabel(datasetFrom, datasetTo)}, the latest official release. Prices are in nominal euros and are not adjusted for inflation.</p>
                {summary.data && <p>{num(summary.data.excludedCount)} transactions in the raw data are left out of this selection. They are sales of several properties at once, commercial premises and statistical outliers, which would distort the price per m².</p>}
                <p className="text-muted-foreground">Changes compare the median of the first {summary.data?.changeWindowMonths ?? 3} months of the selected period with the median of the last {summary.data?.changeWindowMonths ?? 3} months. Small areas and short periods give noisy figures, so periods with fewer than 10 sales are marked.</p>
                <p className="text-muted-foreground">Sources: {DATA_SOURCES.join(", ")}.{lastRefreshed && ` Last loaded at ${lastRefreshed}.`}</p>
              </div>
            </section>
          </div>

          <Transactions filters={filters} scopeLabel={scopeLabel} scale={scale} arrColor={arrColor} isDark={isDark}
            onSelectArr={(a) => selectArr(a)}
            onSelectQuartierName={(name) => { const q = quartiers.find((x) => x.name === name); if (q) patch({ area: { kind: "q", id: q.id } }); }} />
        </main>

        <footer className="mt-6 pt-4 border-t text-[13px] text-muted-foreground flex flex-wrap justify-between gap-2">
          <span>Source: DVF, Direction générale des Finances publiques. {rangeLabel(datasetFrom, datasetTo)}, {longMonthLabel(releaseMonth)} release. Nominal euros.</span>
          <span>Basemap tiles &copy; Esri.</span>
        </footer>
      </div>
    </div>
  );
}
