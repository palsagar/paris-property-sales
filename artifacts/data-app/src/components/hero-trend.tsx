import { memo, useMemo, useState } from "react";
import { useGetSalesTrend, getGetSalesTrendQueryKey, type GranularityParameter, type PropertyTypeParameter, type SalesSummary, type YearRange } from "@workspace/api-client-react";
import { ComposedChart, BarChart, Area, Line, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard, ErrorState, Segmented, SwitchField, TipBox, useChartColors } from "@/components/ui-bits";
import { eur, sqm, sqmOrTooFew, num, pct, orTooFew, houseShareLabel, inArea, keep, tooFew, bucketLabel } from "@/lib/fmt";
import { t } from "@/lib/i18n/messages";
import { keepInSameArea, type areaParams } from "@/lib/areas";
import { parisTrendParams, smoothOn, summaryParams, trendParams, type Selection } from "@/lib/selection-queries";
import { usePanelChoices } from "@/lib/shown-view";
import { yearBucketLabel } from "@/lib/period";
import { track } from "@/lib/analytics";

export type Filters = ReturnType<typeof areaParams> & { propertyType: PropertyTypeParameter; from?: string; to?: string };

const PLOT_H = 260;
const STRIP_H = 64; // 40px of bars plus the x-axis labels
const Y_W = 46;
// Room on the right for the names written at the end of the lines.
const END_W = 72;

/** Writes a line's name and last value just after its last point, so the lines need no legend to be told apart. */
const endLabel = (name: string, color: string, last: number, dy: number) =>
  function EndLabel(p: { x?: number | string; y?: number | string; index?: number; value?: number | string | null }) {
    if (p.index !== last || p.value == null || p.x == null || p.y == null) return <g />;
    return (
      <text x={Number(p.x) + 8} y={Number(p.y) + dy} fill={color} fontSize={12} fontWeight={600} dominantBaseline="middle">
        <tspan x={Number(p.x) + 8}>{name}</tspan>
        <tspan x={Number(p.x) + 8} dy={14} fontWeight={500} style={{ fontFamily: "var(--app-font-mono)" }}>{num(Number(p.value))}</tspan>
      </text>
    );
  };

/** The Change of the Selection in one sentence, so a Visitor reads the answer before the chart. */
function takeaway(s: SalesSummary | undefined, paris: SalesSummary | undefined, areaName: string, kind: Selection["area"]["kind"]): string | null {
  if (!s || s.startMedianPricePerSqm == null || s.endMedianPricePerSqm == null || s.changePct == null) return null;
  const n = s.changeWindowMonths;
  const tr = t().trend;
  const base = tr.takeaway(inArea(areaName, kind), sqm(s.endMedianPricePerSqm), n, num(s.startMedianPricePerSqm), pct(s.changePct));
  return keep(paris?.changePct != null ? base + tr.parisMoved(pct(paris.changePct)) : base);
}

export const HeroTrend = memo(function HeroTrend({ selection, gran, areaName, setGran, isDark, years, summary, paris }: {
  selection: Selection; gran: GranularityParameter; areaName: string; setGran: (g: GranularityParameter) => void; isDark: boolean; years: YearRange[];
  /** The Selection's figures and All Paris's, for the sentence above the chart. */
  summary?: SalesSummary; paris?: SalesSummary;
}) {
  const c = useChartColors(isDark);
  const { choices, setChoices } = usePanelChoices();
  const [showBand, setShowBand] = useState(true);
  const view = { ...selection, gran };
  const isQuartier = selection.area.kind === "q", hasArea = selection.area.kind !== "paris";
  const smooth = smoothOn(gran, isQuartier, choices.smooth);
  const params = trendParams(view, choices);
  const win = params.window;
  const q = useGetSalesTrend(params, { query: { queryKey: getGetSalesTrendQueryKey(params), placeholderData: keepInSameArea(summaryParams(view)) } });
  const allP = parisTrendParams(view, choices);
  const all = useGetSalesTrend(allP, { query: { queryKey: getGetSalesTrendQueryKey(allP), enabled: hasArea } });

  const data = useMemo(() => {
    const pts = q.data ?? [];
    const byP = new Map(pts.map((p) => [p.period, p]));
    const paris = new Map((hasArea ? all.data ?? [] : []).map((p) => [p.period, p.medianPricePerSqm]));
    return pts.map((p) => {
      const prevKey = `${Number(p.period.slice(0, 4)) - 1}${p.period.slice(4)}`;
      const prev = byP.get(prevKey);
      return {
        ...p, shown: gran === "year" ? yearBucketLabel(p.period, bucketLabel(p.period, gran), years) : bucketLabel(p.period, gran), band: [p.p25PricePerSqm, p.p75PricePerSqm] as [number | null, number | null],
        paris: paris.get(p.period), low: p.count > 0 && p.count < 10,
        yoy: prev && prev.medianPricePerSqm && p.medianPricePerSqm != null ? ((p.medianPricePerSqm - prev.medianPricePerSqm) / prev.medianPricePerSqm) * 100 : null,
      };
    });
  }, [q.data, all.data, hasArea, gran, years]);

  // Without the range, the y-axis is fitted to the median (and the All Paris line) so its movement is readable.
  // With the range on, the axis covers P25 to P75 plus 40% of that span on each side, so the range reads as a
  // band inside the plot instead of filling it.
  const domain = useMemo<[number, number]>(() => {
    const line = data.flatMap((d) => [d.medianPricePerSqm, d.paris]).filter((x): x is number => x != null && isFinite(x));
    if (!line.length) return [0, 1];
    let lo = Math.min(...line), hi = Math.max(...line);
    let pad = Math.max((hi - lo) * 0.25, 250);
    if (showBand) {
      lo = Math.min(lo, ...data.map((d) => d.p25PricePerSqm).filter((x) => x != null));
      hi = Math.max(hi, ...data.map((d) => d.p75PricePerSqm).filter((x) => x != null));
      pad = (hi - lo) * 0.4;
    }
    return [Math.max(0, Math.floor((lo - pad) / 500) * 500), Math.ceil((hi + pad) / 500) * 500];
  }, [data, showBand]);
  const lowN = data.filter((d) => d.low).length;
  // The two end labels must not overlap: the lower line's label goes below its point.
  const lastPt = data[data.length - 1];
  const parisBelow = lastPt?.paris != null && lastPt.medianPricePerSqm != null && lastPt.paris < lastPt.medianPricePerSqm;
  const shortName = areaName.replace(/ arrondissement$/, "");
  const noMedian = data.every((d) => d.medianPricePerSqm == null);
  // The charts depend only on their data and settings, so a change elsewhere on the page does not redraw them.
  const ptype = view.ptype;
  const tr = t().trend, allParis = t().fmt.allParis;
  const charts = useMemo(() => (
    <>
          {noMedian ? <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height: PLOT_H }}>{tooFew()}</div> : <ResponsiveContainer width="100%" height={PLOT_H} debounce={0}>
            <ComposedChart data={data} syncId="trend" margin={{ top: 8, right: END_W, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
              <XAxis dataKey="shown" hide />
              <YAxis tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}k`} tick={{ fontSize: 12, fill: c.tick }} stroke={c.tick} width={Y_W} domain={domain} allowDataOverflow tickCount={5} />
              <Tooltip filterNull={false} isAnimationActive={false} cursor={{ stroke: c.tick, strokeDasharray: "3 3" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as (typeof data)[number];
                  if (d.count === 0) return <TipBox title={d.shown} rows={[[tr.sales, tr.noSales]]} />;
                  const rows: [string, string, string?][] = [
                    [tr.medianSqm, sqmOrTooFew(d.medianPricePerSqm), c.accent],
                    [tr.p25p75, d.p25PricePerSqm != null && d.p75PricePerSqm != null ? tr.range(num(d.p25PricePerSqm), num(d.p75PricePerSqm)) : tooFew()],
                    [tr.medianPrice, orTooFew(d.medianPrice, eur)],
                    [tr.sales, num(d.count)],
                  ];
                  const share = ptype === "all" ? houseShareLabel(d.houseShare) : null;
                  if (share) rows.push([tr.houseShare, share]);
                  if (d.yoy != null) rows.push([tr.yoy, pct(d.yoy)]);
                  if (d.paris != null) rows.push([allParis, sqm(d.paris), c.second]);
                  return <TipBox title={d.shown} rows={rows} note={d.low && d.medianPricePerSqm != null ? tr.lowNote : undefined} />;
                }} />
              {showBand && <Area dataKey="band" stroke="none" fill={c.accent} fillOpacity={0.06} isAnimationActive={false} type="linear" activeDot={false} />}
              {showBand && <Line dataKey="p25PricePerSqm" stroke={c.accent} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="1 3" dot={false} activeDot={false} isAnimationActive={false} />}
              {showBand && <Line dataKey="p75PricePerSqm" stroke={c.accent} strokeOpacity={0.45} strokeWidth={1} strokeDasharray="1 3" dot={false} activeDot={false} isAnimationActive={false} />}
              {hasArea && <Line dataKey="paris" stroke={c.second} strokeWidth={1.75} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls
                label={endLabel(allParis, c.second, data.length - 1, parisBelow ? 8 : -22)} />}
              <Line dataKey="medianPricePerSqm" stroke={c.accent} strokeWidth={2.75} isAnimationActive={false} type="linear"
                label={hasArea ? endLabel(shortName, c.accent, data.length - 1, parisBelow ? -22 : 8) : undefined}
                activeDot={{ r: 5, stroke: c.bg, strokeWidth: 2 }}
                dot={(p: { cx?: number; cy?: number | null; index?: number; payload?: { low: boolean } }) =>
                  p.cy == null ? <g key={p.index} /> : p.payload?.low ? <circle key={p.index} cx={p.cx} cy={p.cy} r={4} fill={c.bg} stroke={c.accent} strokeWidth={1.5} strokeDasharray="2 1.5" />
                    : <circle key={p.index} cx={p.cx} cy={p.cy} r={data.length > 30 ? 0 : 2.5} fill={c.accent} />} />
            </ComposedChart>
          </ResponsiveContainer>}
          <ResponsiveContainer width="100%" height={STRIP_H} debounce={0}>
            <BarChart data={data} syncId="trend" margin={{ top: 6, right: END_W, left: 0, bottom: 0 }} barCategoryGap="18%">
              <XAxis dataKey="shown" tick={{ fontSize: 12, fill: c.tick }} stroke={c.tick} minTickGap={28} />
              <YAxis width={Y_W} tick={false} axisLine={false} domain={[0, "dataMax"]}
                label={{ value: tr.sales, position: "insideRight", fill: c.tick, fontSize: 12, offset: 6 }} />
              <Tooltip content={() => null} cursor={{ fill: c.cursor }} isAnimationActive={false} />
              <Bar dataKey="count" isAnimationActive={false} radius={[1, 1, 0, 0]}>
                {data.map((d, i) => <Cell key={i} fill={d.low ? c.accent : c.tick} fillOpacity={d.low ? 0.5 : 0.35} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
    </>
  ), [data, domain, showBand, hasArea, noMedian, c, ptype, parisBelow, shortName, tr, allParis]);

  return (
    <ChartCard testId="trend" title={tr.title(inArea(areaName, selection.area.kind))} isDark={isDark}
      loading={q.isLoading} fetching={q.isFetching || all.isFetching}
      csv={data.map(({ band: _b, shown: _s, ...r }) => r)} csvName="price-trend.csv"
      lede={takeaway(summary, hasArea ? paris : undefined, areaName, selection.area.kind)}
      desc={tr.desc(gran, hasArea, smooth ? win ?? 0 : 0)}
      controls={
        <>
          <Segmented testId="gran" label={tr.timeStep} value={gran} onChange={setGran} options={[["month", tr.month], ["quarter", tr.quarter], ["year", tr.year]]} />
          <SwitchField testId="toggle-smooth" checked={smooth} disabled={gran === "year"} onCheckedChange={(on) => { track("toggle-smoothing", { on }); setChoices((ch) => ({ ...ch, smooth: { gran, isQuartier, on } })); }} label={tr.smoothing} />
          <SwitchField testId="toggle-band" checked={showBand} onCheckedChange={(on) => { track("toggle-band", { on }); setShowBand(on); }} label={tr.band} />
        </>
      }>
      {q.isLoading ? <Skeleton className="w-full" style={{ height: PLOT_H + STRIP_H }} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : data.length === 0 ? (
        <div className="flex items-center justify-center text-muted-foreground text-sm" style={{ height: PLOT_H + STRIP_H }}>{tr.empty}</div>
      ) : (
        <>
          {charts}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[13px] text-muted-foreground">
      ) : data.length === 1 ? (
        // One point draws no line: say why, instead of a lone dot under a wide bar.
        <div className="flex items-center justify-center text-center text-muted-foreground text-sm px-4" style={{ height: PLOT_H + STRIP_H }} data-testid="trend-one-point">{tr.onePoint(gran)}</div>
            <span className="inline-flex items-center gap-1.5"><span className="w-4 h-0.5" style={{ background: c.accent }} />{tr.medianSqm}</span>
            {showBand && <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t border-dotted" style={{ borderColor: c.accent }} />{tr.bandLegend}</span>}
            {hasArea && <span className="inline-flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed" style={{ borderColor: c.second }} />{allParis}</span>}
            <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: c.tick, opacity: 0.4 }} />{tr.count}</span>
            {lowN > 0 && <span className="inline-flex items-center gap-1.5 text-primary"><span className="w-2.5 h-2.5 rounded-full border border-dashed border-primary" />{tr.lowPeriods(lowN)}</span>}
          </div>
        </>
      )}
    </ChartCard>
  );
});
