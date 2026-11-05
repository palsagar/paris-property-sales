import { useMemo, useState } from "react";
import type { AreaStat, AreaTrendPoint } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard, DeltaChip, ErrorState, Segmented, Sparkline, useChartColors } from "@/components/ui-bits";
import { num, sqm, arrLabel, eur } from "@/lib/fmt";

export function Ranking({ stats, trend, loading, fetching, error, retry, scale, domain, selArr, onSelect, isDark }: {
  stats: AreaStat[]; trend: AreaTrendPoint[]; loading: boolean; fetching: boolean; error: boolean; retry: () => void;
  scale: (v: number) => string; domain: [number, number]; selArr?: number; onSelect: (arr: number) => void; isDark: boolean;
}) {
  const c = useChartColors(isDark);
  const [sort, setSort] = useState<"level" | "change">("level");
  const spark = useMemo(() => {
    const m = new Map<string, AreaTrendPoint[]>();
    for (const r of trend) { const a = m.get(r.id) ?? []; a.push(r); m.set(r.id, a); }
    m.forEach((a) => a.sort((x, y) => x.period.localeCompare(y.period)));
    return m;
  }, [trend]);
  const rows = useMemo(() => [...stats].sort((a, b) => sort === "level" ? b.medianPricePerSqm - a.medianPricePerSqm : (b.changePct ?? -1e9) - (a.changePct ?? -1e9)), [stats, sort]);
  const max = Math.max(1, ...stats.map((s) => s.p75PricePerSqm));
  const [lo, hi] = domain;

  return (
    <ChartCard testId="ranking" title="Arrondissements by price per m²" isDark={isDark} loading={loading} fetching={fetching}
      csv={stats} csvName="arrondissements-ranked.csv" desc="Bar: median price per m². Dotted line: the middle half of sales. Then the number of sales, the change over the period and the quarterly trend."
      right={<Segmented label="Sort" testId="rank-sort" value={sort} onChange={(v) => setSort(v as "level" | "change")} options={[["level", "By price"], ["change", "By change"]]} />}>
      {loading ? <div className="space-y-2">{Array.from({ length: 16 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div> :
        error ? <ErrorState onRetry={retry} /> : (
          <div className="-mx-1" data-testid="list-ranking">
            {rows.map((s, i) => {
              const sel = selArr === s.arrondissement;
              const vals = (spark.get(s.id) ?? []).map((p) => p.medianPricePerSqm);
              return (
                <button key={s.id} onClick={() => onSelect(s.arrondissement)} data-testid={`row-rank-${s.id}`}
                  title={`${s.name}: ${sqm(s.medianPricePerSqm)}, median price ${eur(s.medianPrice)}, ${num(s.count)} sales`}
                  className={`w-full grid grid-cols-[18px_30px_1fr_46px_58px_64px] items-center gap-2 px-1 py-[3px] rounded text-left transition-colors ${sel ? "bg-primary/10 ring-1 ring-primary/40" : selArr ? "text-muted-foreground hover:text-foreground hover:bg-muted/60" : "hover:bg-muted/60"}`}>
                  <span className="font-num text-[11.5px] text-muted-foreground text-right">{i + 1}</span>
                  <span className="font-num text-[12px] font-medium">{arrLabel(s.arrondissement)}</span>
                  <span className="relative h-4">
                    <span className="absolute inset-y-0 left-0 w-full rounded-r-sm origin-left transition-transform duration-500" style={{ transform: `scaleX(${s.medianPricePerSqm / max})`, background: scale(s.medianPricePerSqm) }} />
                    <span className="absolute top-1/2 border-t border-dotted opacity-60" style={{ left: `${(s.p25PricePerSqm / max) * 100}%`, width: `${((s.p75PricePerSqm - s.p25PricePerSqm) / max) * 100}%`, borderColor: c.tick }} />
                    <span className="absolute left-1 top-1/2 -translate-y-1/2 font-num text-[10.5px] font-medium" style={{ color: s.medianPricePerSqm > (lo + hi) / 2 ? c.paper : c.ink }}>{num(s.medianPricePerSqm)}</span>
                  </span>
                  <span className="font-num text-[11.5px] text-muted-foreground text-right">{num(s.count)}</span>
                  <span className="text-right"><DeltaChip value={s.changePct} size="xs" /></span>
                  <Sparkline values={vals} color={sel ? c.accent : c.tick} />
                </button>
              );
            })}
            <p className="text-[12px] text-muted-foreground mt-2 px-1">Click a row to show that arrondissement across the page.</p>
          </div>
        )}
    </ChartCard>
  );
}
