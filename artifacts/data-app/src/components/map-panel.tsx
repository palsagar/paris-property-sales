import { useEffect, useMemo, useRef, useState } from "react";
import {
  useGetSalesByQuartier, getGetSalesByQuartierQueryKey, useGetAreaTrend, getGetAreaTrendQueryKey,
  useGetSalesPoints, getGetSalesPointsQueryKey,
  type AreaStat, type GeoFeatureCollection, type PropertyTypeParameter,
} from "@workspace/api-client-react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { SalesMap, type FeatureProps } from "@/components/sales-map";
import { ChartCard, ErrorState, GradientLegend, Segmented } from "@/components/ui-bits";
import { eur, sqm, num, arrLabel, pct, makeDivScale, monthsBefore, monthsBetween, rangeLabel } from "@/lib/fmt";
import type { Area, MapLevel, MapMode } from "@/lib/view-state";

export function MapPanel(props: {
  isDark: boolean; ptype: PropertyTypeParameter; from?: string; to?: string; datasetFrom: string; datasetTo: string;
  area: Area; selArr?: number; areaParams: { arrondissement?: number; quartier?: string };
  mode: MapMode; setMode: (m: MapMode) => void; level: MapLevel; setLevel: (l: MapLevel) => void;
  arrStats: AreaStat[]; arrLoading: boolean; arrError: boolean; retryArr: () => void;
  arrBounds?: GeoFeatureCollection; qBounds?: GeoFeatureCollection;
  scale: (v: number) => string; domain: [number, number];
  travel: string | null; setTravel: (p: string | null) => void;
  onSelect: (p: FeatureProps, level: MapLevel) => void;
}) {
  const { isDark, ptype, from, to, datasetFrom, datasetTo, area, selArr, areaParams, mode, setMode, level, setLevel, arrStats, scale, domain, travel, setTravel } = props;
  const ef = from ?? datasetFrom, et = to ?? datasetTo;

  const qp = { propertyType: ptype, from, to };
  const qStats = useGetSalesByQuartier(qp, { query: { queryKey: getGetSalesByQuartierQueryKey(qp), enabled: level === "quartier" && mode !== "dots" } });
  const lvl = level === "quartier" ? ("quartier" as const) : ("arrondissement" as const);
  const tp = { level: lvl, propertyType: ptype, from, to, granularity: "quarter" as const, window: 4 };
  const travelQ = useGetAreaTrend(tp, { query: { queryKey: getGetAreaTrendQueryKey(tp), enabled: mode === "level" } });

  // Points: default to the latest 12 months of the range.
  const [dotsFull, setDotsFull] = useState(false);
  const long = monthsBetween(ef, et) > 12;
  const dotsFrom = long && !dotsFull ? monthsBefore(et, 11) : from;
  const pp = { propertyType: ptype, ...areaParams, from: dotsFrom, to };
  const points = useGetSalesPoints(pp, { query: { queryKey: getGetSalesPointsQueryKey(pp), enabled: mode === "dots" } });

  const stats = level === "quartier" ? qStats.data ?? [] : arrStats;
  const statById = useMemo(() => new Map(stats.map((s) => [String(s.id), s])), [stats]);

  const { periods, labels, byKey } = useMemo(() => {
    const byKey = new Map<string, { v: number; n: number }>();
    const per = new Map<string, string>();
    for (const r of travelQ.data ?? []) { byKey.set(`${r.id}|${r.period}`, { v: r.medianPricePerSqm, n: r.count }); per.set(r.period, r.label); }
    const periods = [...per.keys()].sort();
    return { periods, labels: per, byKey };
  }, [travelQ.data]);
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
    if (travelOn) { const r = byKey.get(`${id}|${travel}`); return r ? scale(r.v) : null; }
    const s = statById.get(id); return s ? scale(s.medianPricePerSqm) : null;
  };
  const tooltipFor = (id: string, p: FeatureProps) => {
    const s = statById.get(id);
    const head = `<div class="pt-title">${p.name}</div>` + (level === "quartier" ? `<div class="pt-sub">${arrLabel(p.arr)} arrondissement</div>` : "");
    if (travelOn) {
      const r = byKey.get(`${id}|${travel}`);
      return head + `<div class="pt-em">4 quarters to ${travelLabel}</div>` + (r ? `<div>Median <b>${sqm(r.v)}</b></div><div>${num(r.n)} sales</div>` : "<div>Too few sales to show a median</div>");
    }
    if (!s) return head + "<div>No sales in this period</div>";
    return head + `<div class="pt-sub" style="margin-top:4px">${rangeLabel(ef, et)}</div><div>Median <b>${sqm(s.medianPricePerSqm)}</b></div><div>Median price ${eur(s.medianPrice)}</div><div>${num(s.count)} sales</div>` +
      `<div>Change over the period <b>${s.changePct != null ? pct(s.changePct) : "not shown, too few sales"}</b></div>` +
      (s.startMedianPricePerSqm != null && s.endMedianPricePerSqm != null ? `<div class="pt-sub">From ${num(s.startMedianPricePerSqm)} to ${num(s.endMedianPricePerSqm)} EUR/m²</div>` : "");
  };

  const bounds = level === "quartier" && mode !== "dots" ? props.qBounds : props.arrBounds;
  const focusFeature = useMemo(() => {
    if (area.kind === "q") return (props.qBounds?.features.find((f) => (f as { properties: FeatureProps }).properties.id === area.id) as object) ?? null;
    if (area.kind === "arr") return (props.arrBounds?.features.find((f) => (f as { properties: FeatureProps }).properties.arr === area.arr) as object) ?? null;
    return null;
  }, [area, props.qBounds, props.arrBounds]);

  const styleKey = `${mode}-${level}-${travelOn ? travel : "avg"}-${stats.length}-${stats.reduce((a, s) => a + s.count, 0)}-${periods.length}-${domain.join()}`;
  const loading = props.arrLoading || (level === "quartier" && mode !== "dots" && qStats.isLoading) || (mode === "dots" && points.isLoading);
  const fetching = qStats.isFetching || travelQ.isFetching || points.isFetching;
  const csv = mode === "dots" ? points.data ?? [] : travelOn ? (travelQ.data ?? []).filter((r) => r.period === travel) : stats;

  return (
    <ChartCard testId="map" title={mode === "change" ? "Change in price per m², by area" : mode === "dots" ? "Individual sales on the map" : "Median price per m², by area"}
      isDark={isDark} loading={loading} fetching={fetching} csv={csv as object[]} csvName={`paris-map-${mode}-${level}.csv`}
      desc={mode === "change" ? "Median price per m² at the end of the period compared with the start. Click an area to select it for the whole page." :
        mode === "dots" ? "Each dot is one sale, coloured by its price per m²." : "Click an area to select it for the whole page. Use the slider under the map to step through quarters."}
      right={<>
        <Segmented label="Map mode" testId="map-mode" value={mode} onChange={setMode} options={[["level", "Price level"], ["change", "Price change"], ["dots", "Sales"]]} />
        {mode !== "dots" && <Segmented label="Map areas" testId="map-level" value={level} onChange={setLevel} options={[["arr", "Arrondissements"], ["quartier", "Quartiers"]]} />}
      </>}>
      <div className="relative h-[400px] md:h-[clamp(380px,calc(100dvh-300px),620px)] rounded-md overflow-hidden border">
        {props.arrError ? <ErrorState onRetry={props.retryArr} /> : (
          <SalesMap level={mode === "dots" ? "arr" : level} bounds={bounds} isDark={isDark} fillFor={fillFor} tooltipFor={tooltipFor}
            selArr={selArr} selQ={area.kind === "q" ? area.id : undefined} styleKey={styleKey}
            onSelect={(p) => props.onSelect(p, mode === "dots" ? "arr" : level)} outlineOnly={mode === "dots"}
            points={mode === "dots" ? points.data ?? [] : undefined} pointScale={scale} focusFeature={focusFeature} />
        )}
        {loading && <div className="absolute inset-0 z-[450] bg-background/40 flex items-center justify-center pointer-events-none"><Skeleton className="w-48 h-5" /></div>}
        <div className="absolute left-3 bottom-3 z-[400] rounded-md bg-card border px-3 py-2">
          {mode === "change" ? (
            <GradientLegend title={<>Change in price per m², {rangeLabel(ef, et)}</>} min={-maxChange} max={maxChange} mid={0} scale={divScale} fmt={(n) => (n === 0 ? "0%" : pct(n, 0))} />
          ) : (
            <GradientLegend title={<>Median price per m², <span className="font-semibold text-primary">{travelLabel ? `4 quarters to ${travelLabel}` : mode === "dots" ? "per sale" : rangeLabel(ef, et)}</span></>}
              min={domain[0]} max={domain[1]} scale={scale} fmt={(n) => `${num(n)}`} />
          )}
          {mode === "dots" && points.data && <div className="text-[12px] mt-1 text-muted-foreground font-num">{num(points.data.length)} sales plotted</div>}
        </div>
        {mode === "dots" && long && (
          <div className="absolute right-3 top-3 z-[400] rounded-md bg-card border px-3 py-2 text-[12.5px] max-w-[260px]">
            {dotsFull ? <>Showing every sale from {rangeLabel(ef, et)}. </> : <>Showing the latest 12 months, {rangeLabel(dotsFrom!, et)}, so the map stays fast. </>}
            <button className="text-primary underline" onClick={() => setDotsFull((v) => !v)} data-testid="button-dots-range">{dotsFull ? "Back to 12 months" : "Show whole range"}</button>
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
