import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  useGetSalesByQuartier, getGetSalesByQuartierQueryKey, useGetAreaTrend, getGetAreaTrendQueryKey,
  useGetSalesPoints, getGetSalesPointsQueryKey,
  type AreaStat, type AreaTrendPoint, type GeoFeatureCollection, type PropertyTypeParameter,
} from "@workspace/api-client-react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { escapeHtml } from "@/lib/escape";
import { Skeleton } from "@/components/ui/skeleton";
import { SalesMap } from "@/components/sales-map";
import { ChartCard, ErrorState, GradientLegend, Segmented, StepLegend, outlineBtnCls } from "@/components/ui-bits";
import { eur, sqm, num, arrLabel, pct, makeDivScale, rangeLabel, tooFew, houseShareLabel, houseShareWarning, bucketLabel } from "@/lib/fmt";
import { groupDots, type SaleDot } from "@/lib/dots";
import { DEPARTMENT_NAMES, featureState, keepInSameArea, type Area, type DepartmentId, type MapFeature, type areaParams } from "@/lib/areas";
import type { StepScale } from "@/lib/colour-scale";
import { pointParams, quartierStatParams, quartierTrendParams } from "@/lib/selection-queries";
import type { MapLevel, MapMode } from "@/lib/view-state";
import { track } from "@/lib/analytics";
import { t } from "@/lib/i18n/messages";

export const MapPanel = memo(function MapPanel(props: {
  isDark: boolean; ptype: PropertyTypeParameter; from?: string; to?: string; datasetFrom: string; datasetTo: string;
  area: Area; selArr?: number; areaParams: ReturnType<typeof areaParams>;
  mode: MapMode; setMode: (m: MapMode) => void; level: MapLevel; setLevel: (l: MapLevel) => void;
  arrStats: AreaStat[]; communeStats: AreaStat[]; statsLoading: boolean; statsError: boolean; retryStats: () => void;
  arrTrend: AreaTrendPoint[]; communeTrend: AreaTrendPoint[]; trendFetching: boolean;
  arrBounds?: GeoFeatureCollection; qBounds?: GeoFeatureCollection; communeBounds?: GeoFeatureCollection;
  scale: StepScale;
  travel: string | null; setTravel: (p: string | null) => void;
  onSelect: (p: MapFeature) => void; onSelectArea: (a: Area) => void;
}) {
  const { isDark, ptype, from, to, datasetFrom, datasetTo, area, selArr, areaParams: areaP, mode, setMode, level, setLevel, arrStats, communeStats, arrTrend, communeTrend, scale, travel, setTravel } = props;
  const ef = from ?? datasetFrom, et = to ?? datasetTo;

  const sel = { ptype, area, from, to };
  const qp = quartierStatParams(sel);
  const qStats = useGetSalesByQuartier(qp, { query: { queryKey: getGetSalesByQuartierQueryKey(qp), enabled: level === "quartier" && mode !== "dots" } });
  const tp = quartierTrendParams(sel);
  const qTrend = useGetAreaTrend(tp, { query: { queryKey: getGetAreaTrendQueryKey(tp), enabled: level === "quartier" && mode === "level" } });

  // Points: the server returns the newest 5,000 Sales of the Selection at most, and the total.
  const pp = pointParams(sel);
  const points = useGetSalesPoints(pp, { query: { queryKey: getGetSalesPointsQueryKey(pp), enabled: mode === "dots", placeholderData: keepInSameArea(areaP) } });
  const items = points.data?.items;
  const total = points.data?.total ?? 0;
  const dots = useMemo(() => (items ? groupDots(items, level) : undefined), [items, level]);

  // Paris at the chosen level, with the Communes always around it.
  const stats = useMemo(() => [...(level === "quartier" ? qStats.data ?? [] : arrStats), ...communeStats], [level, qStats.data, arrStats, communeStats]);
  const statById = useMemo(() => new Map(stats.map((s) => [String(s.id), s])), [stats]);

  const trendRows = useMemo(() => [...(level === "quartier" ? qTrend.data ?? [] : arrTrend), ...communeTrend], [level, qTrend.data, arrTrend, communeTrend]);
  const { periods, labels, byKey } = useMemo(() => {
    const byKey = new Map<string, { v: number | null; n: number; h: number | null }>();
    const per = new Map<string, string>();
    for (const r of trendRows) { byKey.set(`${r.id}|${r.period}`, { v: r.medianPricePerSqm, n: r.count, h: r.houseShare }); per.set(r.period, bucketLabel(r.period, "quarter")); }
    const periods = [...per.keys()].sort();
    return { periods, labels: per, byKey };
  }, [trendRows]);
  const travelOn = mode === "level" && travel != null && periods.includes(travel);
  const travelLabel = travelOn ? labels.get(travel!) : null;

  const maxChange = useMemo(() => {
    const v = stats.map((s) => Math.abs(s.changePct ?? 0)).sort((a, b) => a - b);
    return Math.max(5, Math.ceil((v[Math.floor(v.length * 0.95)] ?? 10) / 5) * 5);
  }, [stats]);
  const divScale = useMemo(() => makeDivScale(maxChange), [maxChange]);

  // Play / pause through quarters. The slider's event fires when a drag or a key press that moved it ends, not on each step.
  const travelMoved = useRef(false);
  const endTravelMove = () => { if (travelMoved.current) track("time-travel", { via: "slider" }); travelMoved.current = false; };
  const [playing, setPlaying] = useState(false);
  const stateRef = useRef({ periods, travel }); stateRef.current = { periods, travel };
  const setTravelRef = useRef(setTravel); setTravelRef.current = setTravel;
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => {
      const { periods: ps, travel: cur } = stateRef.current;
      const i = cur ? ps.indexOf(cur) : -1;
      if (i + 1 >= ps.length) { setPlaying(false); return; }
      setTravelRef.current(ps[i + 1]);
    }, 700);
    return () => clearInterval(t);
  }, [playing]);
  useEffect(() => { if (mode !== "level") setPlaying(false); }, [mode]);

  const fillFor = (id: string) => {
    if (mode === "change") { const s = statById.get(id); return s?.changePct != null ? divScale(s.changePct) : null; }
    const v = travelOn ? byKey.get(`${id}|${travel}`)?.v : statById.get(id)?.medianPricePerSqm;
    return v != null ? scale.color(v) : null;
  };
  // House share says nothing once one property type is selected.
  const shareLines = (share: number | null | undefined) => {
    if (ptype !== "all") return "";
    const label = houseShareLabel(share), warning = houseShareWarning(share);
    return (label ? `<div>${label}</div>` : "") + (warning ? `<div class="pt-sub" style="white-space:normal;width:250px">${warning}</div>` : "");
  };
  const mt = t().map;
  const tooltipFor = (id: string, p: MapFeature) => {
    const title = `<div class="pt-title">${escapeHtml(p.name)}</div>`;
    if (mode === "dots") return title;
    const sub = p.group ? (p.group === "major" ? t().page.majorTown : DEPARTMENT_NAMES[p.group as DepartmentId]) : p.id ? `${arrLabel(p.arr as number)} arrondissement` : "";
    const head = title + (sub ? `<div class="pt-sub">${sub}</div>` : "");
    if (travelOn) {
      const r = byKey.get(`${id}|${travel}`);
      return head + `<div class="pt-em">${mt.fourQuarters(travelLabel ?? "")}</div>` + (r?.v != null ? `<div>${mt.median(sqm(r.v))}</div>` : `<div>${tooFew()}</div>`) + shareLines(r?.h) + (r ? `<div>${t().sales(num(r.n), r.n)}</div>` : "");
    }
    const s = statById.get(id);
    if (!s) return head + `<div>${mt.noSales}</div>`;
    return head + `<div class="pt-sub" style="margin-top:4px">${rangeLabel(ef, et)}</div>` + (s.medianPricePerSqm != null ? `<div>${mt.median(sqm(s.medianPricePerSqm))}</div>` : `<div>${tooFew()}</div>`) + shareLines(s.houseShare) +
      (s.medianPrice != null ? `<div>${mt.medianPrice(eur(s.medianPrice))}</div>` : "") + `<div>${t().sales(num(s.count), s.count)}</div>` +
      `<div>${mt.changeOver(s.changePct != null ? pct(s.changePct) : mt.notShown)}</div>` +
      (s.startMedianPricePerSqm != null && s.endMedianPricePerSqm != null ? `<div class="pt-sub">${mt.fromTo(num(s.startMedianPricePerSqm), num(s.endMedianPricePerSqm))}</div>` : "");
  };

  // A dot names and selects the Area recorded on its Sale, which the rounded position can place across a boundary.
  const quartierNames = useMemo(() => new Map((props.qBounds?.features ?? []).map((f) => {
    const q = (f as { properties: MapFeature }).properties;
    return [q.id, q.name];
  })), [props.qBounds]);
  const dotName = (d: SaleDot) => {
    const p = d.sales[0]!;
    return (level === "quartier" && p.quartier != null && quartierNames.get(p.quartier)) || p.areaName;
  };
  // A dot only selects: `onSelectArea` never clicks the Area off, even on a double-click while the page updates.
  const selectDot = (d: SaleDot) => props.onSelectArea(d.area);

  const parisBounds = level === "quartier" && mode !== "dots" ? props.qBounds : props.arrBounds;
  const bounds = useMemo(() => (parisBounds && props.communeBounds ? { ...parisBounds, features: [...props.communeBounds.features, ...parisBounds.features] } : undefined), [parisBounds, props.communeBounds]);
  const focusFeature = useMemo(() => {
    const features = (b?: GeoFeatureCollection) => (b?.features ?? []) as { properties: MapFeature }[];
    if (area.kind === "q") return features(props.qBounds).find((f) => f.properties.id === area.id) ?? null;
    if (area.kind === "arr") return features(props.arrBounds).find((f) => f.properties.arr === area.arr) ?? null;
    if (area.kind === "commune") return features(props.communeBounds).find((f) => f.properties.id === area.id) ?? null;
    if (area.kind === "department") {
      const inDept = features(props.communeBounds).filter((f) => f.properties.group === area.id);
      return inDept.length ? { type: "FeatureCollection", features: inDept } : null;
    }
    return null;
  }, [area, props.qBounds, props.arrBounds, props.communeBounds]);

  const styleKey = `${mode}-${level}-${travelOn ? travel : "avg"}-${stats.length}-${stats.reduce((a, s) => a + s.count, 0)}-${periods.length}-${scale.thresholds.join()}-${JSON.stringify(area)}`;
  const loading = props.statsLoading || (level === "quartier" && mode !== "dots" && qStats.isLoading) || (mode === "dots" && points.isLoading);
  const fetching = qStats.isFetching || qTrend.isFetching || props.trendFetching || points.isFetching;
  const csv = mode === "dots" ? items ?? [] : travelOn ? trendRows.filter((r) => r.period === travel) : stats;

  return (
    <ChartCard testId="map" level={3} title={mode === "change" ? mt.changeTitle : mode === "dots" ? mt.dotsTitle : mt.levelTitle}
      isDark={isDark} loading={loading} fetching={fetching} csv={csv as object[]} csvName={`map-${mode}-${level}.csv`}
      desc={mode === "change" ? mt.changeDesc : mode === "dots" ? mt.dotsDesc : mt.levelDesc}
      controls={<>
        <Segmented label={mt.shows} testId="map-mode" value={mode} onChange={setMode} options={[["level", mt.level], ["change", mt.change], ["dots", mt.dots]]} />
        {mode !== "dots" && <Segmented label={mt.detail} testId="map-level" value={level} onChange={setLevel} options={[["arr", "Arrondissements"], ["quartier", "Quartiers"]]} />}
      </>}>
      {/* isolate: Leaflet's z-indexes (400 to 1000) stay inside the map, so the sticky Selection bar stays on top of it. */}
      <div className="relative isolate h-[360px] md:h-[clamp(380px,calc(100dvh-320px),560px)] rounded-lg overflow-hidden border">
        {props.statsError ? <ErrorState onRetry={props.retryStats} /> : (
          <SalesMap level={mode === "dots" ? "arr" : level} bounds={bounds} isDark={isDark} fillFor={fillFor} tooltipFor={tooltipFor}
            stateOf={(p) => featureState(p, area, selArr)} styleKey={styleKey}
            onSelect={props.onSelect} outlineOnly={mode === "dots"} labels={mode !== "dots" && level === "arr"}
            dots={mode === "dots" ? dots ?? [] : undefined} pointScale={scale.color} dotName={dotName} onSelectDot={selectDot} focusFeature={focusFeature} />
        )}
        {loading && <div className="absolute inset-0 z-[450] bg-background/40 flex items-center justify-center pointer-events-none"><Skeleton className="w-48 h-5" /></div>}
        {mode === "dots" && items && total > items.length && (
          <div className="absolute left-3 top-3 z-[400] rounded-lg bg-card border px-3 py-2 text-[13px] max-w-[260px] shadow-md" data-testid="text-dots-cap">
            {mt.cap(num(items.length), num(total))}
          </div>
        )}
      </div>
      {/* The legend sits under the map, not on it: the map keeps its area and the thresholds can be read at 12 px. */}
      <div className="mt-3">
        {mode === "change" ? (
          <GradientLegend title={<>{mt.changeLegend}{rangeLabel(ef, et)}</>} min={-maxChange} max={maxChange} mid={0} scale={divScale} fmt={(n) => (n === 0 ? "0%" : pct(n, 0))} className="w-full sm:max-w-[420px]" />
        ) : (
          <StepLegend title={<>{mt.levelLegend}<span className="font-semibold text-foreground">{travelLabel ? mt.fourQuarters(travelLabel) : mode === "dots" ? mt.perDot : rangeLabel(ef, et)}</span>{mt.ninth}</>}
            scale={scale} fmt={(n) => `${(n / 1000).toFixed(1)}k`} />
        )}
        {mode === "dots" && items && total <= items.length && <div className="text-[13px] mt-1 text-muted-foreground font-num">{mt.plotted(num(total))}</div>}
      </div>
      {mode === "level" && (
        <div className="mt-3 pt-3 border-t flex flex-wrap sm:flex-nowrap items-center gap-3 print:hidden" data-testid="time-travel">
          <button onClick={() => { if (!playing) track("time-travel", { via: "play" }); if (!playing && (!travelOn || travel === periods[periods.length - 1])) setTravel(periods[0]); setPlaying((p) => !p); }}
            disabled={periods.length < 2} data-testid="button-play" aria-label={playing ? "Pause" : mt.play}
            className="h-10 w-10 shrink-0 rounded-full bg-foreground text-background flex items-center justify-center transition-transform active:scale-95 disabled:opacity-40">
            {playing ? <Pause className="w-4 h-4" aria-hidden /> : <Play className="w-4 h-4 ml-0.5" aria-hidden />}
          </button>
          <div className="flex-1 min-w-[160px]">
            <input type="range" min={0} max={Math.max(0, periods.length - 1)} value={travelOn ? periods.indexOf(travel!) : periods.length - 1}
              onChange={(e) => { travelMoved.current = true; setPlaying(false); setTravel(periods[Number(e.target.value)]); }}
              onPointerUp={endTravelMove} onKeyUp={endTravelMove} className="w-full h-6 accent-[hsl(var(--primary))]" data-testid="slider-travel" aria-label={mt.slider} />
            <div className="flex justify-between text-[12px] text-muted-foreground font-num"><span>{labels.get(periods[0] ?? "")}</span><span>{labels.get(periods[periods.length - 1] ?? "")}</span></div>
          </div>
          <div className="sm:w-[132px] sm:text-right" aria-live="polite">
            <div className="font-num font-medium text-[15px] leading-tight">{travelLabel ?? mt.whole}</div>
            <div className="text-[13px] text-muted-foreground">{travelLabel ? mt.ending : mt.forPeriod}</div>
          </div>
          <button onClick={() => { setPlaying(false); setTravel(null); }} disabled={!travelOn} data-testid="button-travel-reset"
            className={outlineBtnCls}><RotateCcw className="w-4 h-4" aria-hidden />{mt.reset}</button>
        </div>
      )}
    </ChartCard>
  );
});
