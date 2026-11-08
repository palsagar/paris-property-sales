import { memo, useMemo, useState } from "react";
import type { AreaStat, AreaTrendPoint } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DeltaChip, ErrorState, Segmented, Sparkline, useChartColors } from "@/components/ui-bits";
import { num, sqm, arrLabel, eur, TOO_FEW, houseShareWarning, houseShareLabel } from "@/lib/fmt";
import type { Area, RankGroup } from "@/lib/areas";
import type { StepScale } from "@/lib/colour-scale";
import type { PropertyTypeParameter } from "@workspace/api-client-react";
import { track } from "@/lib/analytics";

export const RANK_OPTIONS: [RankGroup, string][] = [
  ["paris", "Paris"], ["92", "Hauts-de-Seine"], ["93", "Seine-Saint-Denis"], ["94", "Val-de-Marne"], ["major", "Major towns"],
];

/** The Area that a row of the ranking or the heat map stands for. */
export const statArea = (s: AreaStat): Area => (s.arrondissement != null ? { kind: "arr", arr: s.arrondissement } : { kind: "commune", id: s.id });

/**
 * The ranking of the Areas of one group, the "Ranking" tab of the Areas card (areas-card.tsx). Each row selects its
 * Area. On a laptop the list scrolls inside the card when the group is long; on a phone the page scrolls instead.
 */
export const Ranking = memo(function Ranking({ stats, trend, loading, error, retry, scale, selId, onSelect, ptype, isDark }: {
  stats: AreaStat[]; trend: AreaTrendPoint[]; loading: boolean; error: boolean; retry: () => void;
  scale: StepScale; selId?: string; onSelect: (a: Area) => void; ptype: PropertyTypeParameter; isDark: boolean;
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
  // In Paris the house share is close to 0% everywhere, so the column would only add noise.
  const showShare = ptype === "all" && stats.some((s) => (s.houseShare ?? 0) >= 5);
  // Paris rows hold "6e"; Commune rows hold a town's name. Whole class names, so Tailwind finds them in the source.
  const isParis = stats.some((s) => s.arrondissement != null);
  const cols = isParis
    ? (showShare
      ? "grid-cols-[22px_36px_52px_minmax(48px,1fr)_64px] sm:grid-cols-[22px_36px_52px_minmax(60px,1fr)_52px_40px_68px_56px]"
      : "grid-cols-[22px_36px_52px_minmax(48px,1fr)_64px] sm:grid-cols-[22px_36px_52px_minmax(60px,1fr)_52px_68px_56px]")
    : (showShare
      ? "grid-cols-[22px_minmax(72px,112px)_52px_minmax(40px,1fr)_64px] sm:grid-cols-[22px_minmax(96px,140px)_52px_minmax(60px,1fr)_52px_40px_68px_56px]"
      : "grid-cols-[22px_minmax(72px,112px)_52px_minmax(40px,1fr)_64px] sm:grid-cols-[22px_minmax(96px,140px)_52px_minmax(60px,1fr)_52px_68px_56px]");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented label="Sort the list" testId="rank-sort" value={sort}
          onChange={(v) => { if (v !== sort) track("sort-ranking", { by: v === "level" ? "price" : "change" }); setSort(v as "level" | "change"); }}
          options={[["level", "By price"], ["change", "By change"]]} />
        <p className="text-[13px] text-muted-foreground">Bar: median price per m². Dotted line: the middle half of sales.</p>
      </div>
      {loading ? <div className="space-y-2">{Array.from({ length: 16 }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)}</div> :
        error ? <ErrorState onRetry={retry} /> : (
          <div className="-mx-1" data-testid="list-ranking">
            <div className={`grid ${cols} items-center gap-2 px-1.5 pb-1 text-[12px] text-muted-foreground`} aria-hidden>
              <span className="text-right">#</span><span>Area</span><span className="text-right">EUR/m²</span><span />
              <span className="hidden sm:block text-right">Sales</span>
              {showShare && <span className="hidden sm:block text-right">Houses</span>}<span>Change</span><span className="hidden sm:block">Quarters</span>
            </div>
            <div className="md:max-h-[640px] md:overflow-y-auto">
              {rows.map((s, i) => {
                const sel = selId === s.id;
                const vals = (spark.get(s.id) ?? []).map((p) => p.medianPricePerSqm).filter((v): v is number => v != null);
                const m = s.medianPricePerSqm;
                const warn = showShare ? houseShareWarning(s.houseShare) : null;
                const label = s.arrondissement != null ? arrLabel(s.arrondissement) : s.name;
                return (
                  <button key={s.id} type="button" onClick={() => onSelect(statArea(s))} data-testid={`row-rank-${s.id}`} aria-pressed={sel}
                    aria-label={`${sel ? "Selected: " : ""}${s.name}. ${m == null ? TOO_FEW : `Median ${sqm(m)}, median price ${eur(s.medianPrice ?? 0)}`}, ${num(s.count)} sales`}
                    className={`no-tap w-full grid ${cols} items-center gap-2 px-1.5 min-h-9 rounded-md text-left transition-colors ${sel ? "bg-sunken font-semibold ring-1 ring-foreground/30" : selId ? "text-muted-foreground hover:text-foreground hover:bg-sunken/70" : "hover:bg-sunken/70"}`}>
                    <span className="font-num text-[12px] text-muted-foreground text-right">{i + 1}</span>
                    <span className="text-[14px] truncate" title={s.name}>{label}</span>
                    <span className="font-num text-[13px] text-right whitespace-nowrap">{m == null ? "–" : num(m)}</span>
                    {m == null ? <span className="text-[12px] text-muted-foreground truncate">{TOO_FEW}</span> : (
                      <span className="relative h-4">
                        <span className="absolute inset-y-0 left-0 w-full rounded-[3px] origin-left transition-transform duration-500" style={{ transform: `scaleX(${m / max})`, background: scale.color(m) }} />
                        {s.p25PricePerSqm != null && s.p75PricePerSqm != null && <span className="absolute top-1/2 -translate-y-1/2 border-t-2 border-dotted" style={{ left: `${(s.p25PricePerSqm / max) * 100}%`, width: `${((s.p75PricePerSqm - s.p25PricePerSqm) / max) * 100}%`, borderColor: c.ink, opacity: 0.6 }} />}
                      </span>
                    )}
                    <span className="hidden sm:block font-num text-[12px] text-muted-foreground text-right whitespace-nowrap font-normal">{num(s.count)}</span>
                    {showShare && <span className={`hidden sm:block font-num text-[12px] text-right ${warn ? "text-primary font-semibold" : "text-muted-foreground font-normal"}`} title={warn ?? undefined}>{houseShareLabel(s.houseShare)?.replace(" houses", "")}</span>}
                    <span><DeltaChip value={s.changePct} size="xs" /></span>
                    <span className="hidden sm:block"><Sparkline values={vals} color={sel ? c.accent : c.tick} w={56} /></span>
                  </button>
                );
              })}
            </div>
            {showShare && <p className="text-[13px] text-muted-foreground mt-2 px-1">Houses: their share of the sales. A share above 10% is in bold, because a house's price includes its land and the median is harder to compare.</p>}
          </div>
        )}
    </div>
  );
});
