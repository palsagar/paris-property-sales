import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetSalesByQuartier, getGetSalesByQuartierQueryKey, useGetAreaTrend, getGetAreaTrendQueryKey,
  useGetSalesPoints, getGetSalesPointsQueryKey,
  type AreaStat, type AreaTrendPoint, type GeoFeatureCollection, type PropertyTypeParameter,
} from "@workspace/api-client-react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { escapeHtml } from "@/lib/escape";
import { Skeleton } from "@/components/ui/skeleton";
import { SalesMap } from "@/components/sales-map";
import { ChartCard, ErrorState, GradientLegend, Segmented, StepLegend } from "@/components/ui-bits";
import { eur, sqm, num, arrLabel, pct, makeDivScale, rangeLabel, TOO_FEW, houseShareLabel, houseShareWarning } from "@/lib/fmt";
import { groupDots, type SaleDot } from "@/lib/dots";
import { DEPARTMENT_NAMES, featureState, keepInSameArea, type Area, type DepartmentId, type MapFeature, type areaParams } from "@/lib/areas";
import type { StepScale } from "@/lib/colour-scale";
import type { MapLevel, MapMode } from "@/lib/view-state";

export function MapPanel(props: {
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

  const qp = { propertyType: ptype, from, to };
  const qStats = useGetSalesByQuartier(qp, { query: { queryKey: getGetSalesByQuartierQueryKey(qp), enabled: level === "quartier" && mode !== "dots" } });
  const tp = { level: "quartier" as const, propertyType: ptype, from, to, granularity: "quarter" as const, window: 4 };
  const qTrend = useGetAreaTrend(tp, { query: { queryKey: getGetAreaTrendQueryKey(tp), enabled: level === "quartier" && mode === "level" } });

  // Points: the server returns the newest 5,000 Sales of the Selection at most, and the total.
  const pp = { propertyType: ptype, ...areaP, from, to };
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
    for (const r of trendRows) { byKey.set(`${r.id}|${r.period}`, { v: r.medianPricePerSqm, n: r.count, h: r.houseShare }); per.set(r.period, r.label); }
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

  // Play / pause through quarters.
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
  const tooltipFor = (id: string, p: MapFeature) => {
    const title = `<div class="pt-title">${escapeHtml(p.name)}</div>`;
    if (mode === "dots") return title;
    const sub = p.group ? (p.group === "major" ? "Major town" : DEPARTMENT_NAMES[p.group as DepartmentId]) : p.id ? `${arrLabel(p.arr as number)} arrondissement` : "";
    const head = title + (sub ? `<div class="pt-sub">${sub}</div>` : "");
    if (travelOn) {
      const r = byKey.get(`${id}|${travel}`);
      return head + `<div class="pt-em">4 quarters to ${travelLabel}</div>` + (r?.v != null ? `<div>Median <b>${sqm(r.v)}</b></div>` : `<div>${TOO_FEW}</div>`) + shareLines(r?.h) + (r ? `<div>${num(r.n)} sales</div>` : "");
    }
    const s = statById.get(id);
    if (!s) return head + "<div>No sales in this period</div>";
    return head + `<div class="pt-sub" style="margin-top:4px">${rangeLabel(ef, et)}</div>` + (s.medianPricePerSqm != null ? `<div>Median <b>${sqm(s.medianPricePerSqm)}</b></div>` : `<div>${TOO_FEW}</div>`) + shareLines(s.houseShare) +
      (s.medianPrice != null ? `<div>Median price ${eur(s.medianPrice)}</div>` : "") + `<div>${num(s.count)} sales</div>` +
      `<div>Change over the period <b>${s.changePct != null ? pct(s.changePct) : "not shown, too few sales"}</b></div>` +
      (s.startMedianPricePerSqm != null && s.endMedianPricePerSqm != null ? `<div class="pt-sub">From ${num(s.startMedianPricePerSqm)} to ${num(s.endMedianPricePerSqm)} EUR/m²</div>` : "");
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
  // A dot only selects: a click on a dot in the selected Area must not click the Area off.
  const selectDot = (d: SaleDot) => {
    if (JSON.stringify(d.area) !== JSON.stringify(area)) props.onSelectArea(d.area);
  };

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
    <ChartCard testId="map" title={mode === "change" ? "Change in price per m², by area" : mode === "dots" ? "Individual sales on the map" : "Median price per m², by area"}
      isDark={isDark} loading={loading} fetching={fetching} csv={csv as object[]} csvName={`map-${mode}-${level}.csv`}
      desc={mode === "change" ? "Median price per m² at the end of the period compared with the start. Communes appear around Paris at each level. Click an area to select it for the whole page." :
        mode === "dots" ? "Each dot holds the sales at one position, rounded to about 100 m and moved slightly so that the dots do not form a grid. A larger dot holds more sales. Its colour is their median price per m². Click a dot or an area to select it for the whole page." : "Communes appear around Paris at each level. Click an area to select it for the whole page. Use the slider under the map to step through quarters."}
      right={<>
        <Segmented label="Map mode" testId="map-mode" value={mode} onChange={setMode} options={[["level", "Price level"], ["change", "Price change"], ["dots", "Sales"]]} />
        {mode !== "dots" && <Segmented label="Map areas" testId="map-level" value={level} onChange={setLevel} options={[["arr", "Arrondissements"], ["quartier", "Quartiers"]]} />}
      </>}>
      <div className="relative h-[400px] md:h-[clamp(380px,calc(100dvh-300px),620px)] rounded-md overflow-hidden border">
        {props.statsError ? <ErrorState onRetry={props.retryStats} /> : (
          <SalesMap level={mode === "dots" ? "arr" : level} bounds={bounds} isDark={isDark} fillFor={fillFor} tooltipFor={tooltipFor}
            stateOf={(p) => featureState(p, area, selArr)} styleKey={styleKey}
            onSelect={props.onSelect} outlineOnly={mode === "dots"}
            dots={mode === "dots" ? dots ?? [] : undefined} pointScale={scale.color} dotName={dotName} onSelectDot={selectDot} focusFeature={focusFeature} />
        )}
        {loading && <div className="absolute inset-0 z-[450] bg-background/40 flex items-center justify-center pointer-events-none"><Skeleton className="w-48 h-5" /></div>}
        <div className="absolute left-3 bottom-3 z-[400] rounded-md bg-card border px-3 py-2">
          {mode === "change" ? (
            <GradientLegend title={<>Change in price per m², {rangeLabel(ef, et)}</>} min={-maxChange} max={maxChange} mid={0} scale={divScale} fmt={(n) => (n === 0 ? "0%" : pct(n, 0))} />
          ) : (
            <StepLegend title={<>Median price per m², <span className="font-semibold text-primary">{travelLabel ? `4 quarters to ${travelLabel}` : mode === "dots" ? "per dot" : rangeLabel(ef, et)}</span></>}
              scale={scale} fmt={(n) => `${(n / 1000).toFixed(1)}k`} />
          )}
          {mode === "dots" && items && total <= items.length && <div className="text-[12px] mt-1 text-muted-foreground font-num">{num(total)} sales plotted</div>}
        </div>
        {mode === "dots" && items && total > items.length && (
          <div className="absolute right-3 top-3 z-[400] rounded-md bg-card border px-3 py-2 text-[12.5px] max-w-[260px]" data-testid="text-dots-cap">
            Showing the newest {num(items.length)} of {num(total)} sales with a known position. Choose a shorter period or a smaller area to see more.
          </div>
        )}
      </div>
      {mode === "level" && (
        <div className="mt-3 flex flex-wrap sm:flex-nowrap items-center gap-3 print:hidden" data-testid="time-travel">
          <button onClick={() => { if (!playing && (!travelOn || travel === periods[periods.length - 1])) setTravel(periods[0]); setPlaying((p) => !p); }}
            disabled={periods.length < 2} data-testid="button-play" aria-label={playing ? "Pause" : "Play through the quarters"}
            className="h-8 w-8 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center transition-transform active:scale-90 disabled:opacity-40">
            {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 ml-0.5" />}
          </button>
          <div className="flex-1">
            <input type="range" min={0} max={Math.max(0, periods.length - 1)} value={travelOn ? periods.indexOf(travel!) : periods.length - 1}
              onChange={(e) => { setPlaying(false); setTravel(periods[Number(e.target.value)]); }} className="w-full accent-[hsl(var(--primary))]" data-testid="slider-travel" aria-label="Quarter shown on the map" />
            <div className="flex justify-between text-[12px] text-muted-foreground font-num"><span>{labels.get(periods[0] ?? "")}</span><span>{labels.get(periods[periods.length - 1] ?? "")}</span></div>
          </div>
          <div className="w-[124px] text-right">
            <div className="font-display font-bold text-[18px] leading-none flex items-center justify-end gap-1.5">{travelLabel ?? "Whole range"}</div>
            <div className="text-[12px] text-muted-foreground">{travelLabel ? "4 quarters ending here" : "Median for the period"}</div>
          </div>
          <button onClick={() => { setPlaying(false); setTravel(null); }} disabled={!travelOn} data-testid="button-travel-reset"
            className="h-8 px-2.5 rounded-md border text-[13px] flex items-center gap-1 hover:bg-muted disabled:opacity-40"><RotateCcw className="w-3 h-3" />Back to range average</button>
        </div>
      )}
    </ChartCard>
  );
}
