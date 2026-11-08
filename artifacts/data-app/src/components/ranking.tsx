import { memo, useMemo, useState } from "react";
import type { AreaStat, AreaTrendPoint } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard, DeltaChip, ErrorState, Segmented, Sparkline, useChartColors } from "@/components/ui-bits";
import { num, sqm, arrLabel, eur, TOO_FEW, houseShareWarning, houseShareLabel } from "@/lib/fmt";
import type { Area, RankGroup } from "@/lib/areas";
import type { StepScale } from "@/lib/colour-scale";
import type { PropertyTypeParameter } from "@workspace/api-client-react";
import { track } from "@/lib/analytics";

const RANK_OPTIONS: [RankGroup, string][] = [
  ["paris", "Paris"], ["92", "Hauts-de-Seine"], ["93", "Seine-Saint-Denis"], ["94", "Val-de-Marne"], ["major", "Major towns"],
];

/** Chooses which group of Areas the ranking and the heat map list. Both cards show one, bound to one value. */
export function RankSwitch({ value, onChange, testId }: { value: RankGroup; onChange: (v: RankGroup) => void; testId: string }) {
  return <div className="mb-3"><Segmented label="Show" testId={testId} value={value} onChange={onChange} options={RANK_OPTIONS} /></div>;
}

/** The Area that a row of the ranking or the heat map stands for. */
const statArea = (s: AreaStat): Area => (s.arrondissement != null ? { kind: "arr", arr: s.arrondissement } : { kind: "commune", id: s.id });

export const Ranking = memo(function Ranking({ stats, trend, loading, fetching, error, retry, scale, selId, onSelect, rank, onRank, ptype, isDark }: {
  stats: AreaStat[]; trend: AreaTrendPoint[]; loading: boolean; fetching: boolean; error: boolean; retry: () => void;
  scale: StepScale; selId?: string; onSelect: (a: Area) => void; rank: RankGroup; onRank: (r: RankGroup) => void;
  ptype: PropertyTypeParameter; isDark: boolean;
}) {
  const c = useChartColors(isDark);
  const [sort, setSort] = useState<"level" | "change">("level");
  const spark = useMemo(() => {
    const m = new Map<string, AreaTrendPoint[]>();
    for (const r of trend) { const a = m.get(r.id) ?? []; a.push(r); m.set(r.id, a); }
    m.forEach((a) => a.sort((x, y) => x.period.localeCompare(y.period)));
    return m;
  }, [trend]);
  // Areas with too few Sales have no median and sort last.
  const rows = useMemo(() => [...stats].sort((a, b) => {
    if ((a.medianPricePerSqm == null) !== (b.medianPricePerSqm == null)) return a.medianPricePerSqm == null ? 1 : -1;
    return sort === "level" ? (b.medianPricePerSqm ?? 0) - (a.medianPricePerSqm ?? 0) : (b.changePct ?? -1e9) - (a.changePct ?? -1e9);
  }), [stats, sort]);
  const max = Math.max(1, ...stats.map((s) => s.p75PricePerSqm ?? 0));
  const half = scale.colors.length / 2;
  const showShare = ptype === "all";

  return (
    <ChartCard testId="ranking" title={rank === "paris" ? "Arrondissements by price per m²" : "Communes by price per m²"} isDark={isDark} loading={loading} fetching={fetching}
      csv={stats} csvName={`ranking-${rank}.csv`} desc="Bar: median price per m². Dotted line: the middle half of sales. Then the number of sales, the change over the period and the quarterly trend."
      right={<Segmented label="Sort" testId="rank-sort" value={sort} onChange={(v) => { if (v !== sort) track("sort-ranking", { by: v === "level" ? "price" : "change" }); setSort(v as "level" | "change"); }} options={[["level", "By price"], ["change", "By change"]]} />}>
      <RankSwitch value={rank} onChange={onRank} testId="rank-switch" />
      {loading ? <div className="space-y-2">{Array.from({ length: 16 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div> :
        error ? <ErrorState onRetry={retry} /> : (
          <div className="-mx-1" data-testid="list-ranking">
            <div className="max-h-[560px] overflow-y-auto">
              {rows.map((s, i) => {
                const sel = selId === s.id;
                const vals = (spark.get(s.id) ?? []).map((p) => p.medianPricePerSqm).filter((v): v is number => v != null);
                const m = s.medianPricePerSqm;
                const warn = showShare ? houseShareWarning(s.houseShare) : null;
                return (
                  <button key={s.id} onClick={() => onSelect(statArea(s))} data-testid={`row-rank-${s.id}`}
                    title={m == null ? `${s.name}: ${TOO_FEW}, ${num(s.count)} sales` : `${s.name}: ${sqm(m)}, median price ${eur(s.medianPrice ?? 0)}, ${num(s.count)} sales`}
                    className={`w-full grid grid-cols-[18px_minmax(72px,110px)_minmax(60px,1fr)_42px_52px] sm:grid-cols-[18px_110px_minmax(60px,1fr)_42px_34px_52px_56px] items-center gap-1.5 px-1 py-[3px] rounded text-left transition-colors ${sel ? "bg-primary/10 ring-1 ring-primary/40" : selId ? "text-muted-foreground hover:text-foreground hover:bg-muted/60" : "hover:bg-muted/60"}`}>
                    <span className="font-num text-[11.5px] text-muted-foreground text-right">{i + 1}</span>
                    <span className="font-num text-[12px] font-medium truncate">{s.arrondissement != null ? arrLabel(s.arrondissement) : s.name}</span>
                    {m == null ? <span className="font-num text-[10.5px] text-muted-foreground truncate">{TOO_FEW}</span> : (
                      <span className="relative h-4">
                        <span className="absolute inset-y-0 left-0 w-full rounded-r-sm origin-left transition-transform duration-500" style={{ transform: `scaleX(${m / max})`, background: scale.color(m) }} />
                        {s.p25PricePerSqm != null && s.p75PricePerSqm != null && <span className="absolute top-1/2 border-t border-dotted opacity-60" style={{ left: `${(s.p25PricePerSqm / max) * 100}%`, width: `${((s.p75PricePerSqm - s.p25PricePerSqm) / max) * 100}%`, borderColor: c.tick }} />}
                        <span className="absolute left-1 top-1/2 -translate-y-1/2 font-num text-[10.5px] font-medium" style={{ color: scale.index(m) >= half ? c.paper : c.ink }}>{num(m)}</span>
                      </span>
                    )}
                    <span className="font-num text-[11.5px] text-muted-foreground text-right whitespace-nowrap">{num(s.count)}</span>
                    <span className={`hidden sm:block font-num text-[11px] text-right ${warn ? "text-primary font-semibold" : "text-muted-foreground"}`} title={warn ?? undefined}>{showShare ? houseShareLabel(s.houseShare)?.replace(" houses", "") : ""}</span>
                    <span className="text-right"><DeltaChip value={s.changePct} size="xs" /></span>
                    <span className="hidden sm:block"><Sparkline values={vals} color={sel ? c.accent : c.tick} w={56} /></span>
                  </button>
                );
              })}
            </div>
            {showShare && <p className="text-[12px] text-muted-foreground mt-2 px-1">The percentage next to the number of sales is the share of houses. A share above 10% is in bold, because a house's price includes its land and the median is harder to compare.</p>}
            <p className="text-[12px] text-muted-foreground mt-2 px-1">Click a row to show that area across the page.</p>
          </div>
        )}
    </ChartCard>
  );
});
