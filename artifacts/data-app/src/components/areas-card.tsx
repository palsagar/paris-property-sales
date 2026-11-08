import { memo, useId, useState } from "react";
import type { AreaStat, AreaTrendPoint, PropertyTypeParameter } from "@workspace/api-client-react";
import { ChevronDown } from "lucide-react";
import { ChartCard, Segmented } from "@/components/ui-bits";
import { Ranking, RANK_OPTIONS } from "@/components/ranking";
import { Heatmap } from "@/components/heatmap";
import type { Area, RankGroup } from "@/lib/areas";
import type { StepScale } from "@/lib/colour-scale";
import { track } from "@/lib/analytics";

type Tab = "ranking" | "quarters";

/**
 * The Areas of one group, as a ranking or quarter by quarter. Both views list the same rows, so they share one card and
 * one group picker; before, the ranking and the heat map each had a copy of the group switch bound to the same value.
 */
export const AreasCard = memo(function AreasCard({ rank, onRank, stats, trend, heatData, rows, loading, heatLoading, fetching, error, heatError, retry, retryHeat,
  scale, domain, selId, onSelect, onSelectRow, ptype, travel, onSelectPeriod, isDark }: {
  rank: RankGroup; onRank: (r: RankGroup) => void;
  stats: AreaStat[]; trend: AreaTrendPoint[]; heatData: AreaTrendPoint[]; rows: { id: string; label: string }[];
  loading: boolean; heatLoading: boolean; fetching: boolean; error: boolean; heatError: boolean; retry: () => void; retryHeat: () => void;
  scale: StepScale; domain: [number, number]; selId?: string; onSelect: (a: Area) => void; onSelectRow: (id: string) => void;
  ptype: PropertyTypeParameter; travel: string | null; onSelectPeriod: (p: string) => void; isDark: boolean;
}) {
  const [tab, setTab] = useState<Tab>("ranking");
  const groupId = useId();
  const title = rank === "paris" ? "Arrondissements of Paris" : rank === "major" ? "Major towns" : `Communes of ${RANK_OPTIONS.find(([v]) => v === rank)![1]}`;
  return (
    <ChartCard testId="areas" level={3} title={title} isDark={isDark} loading={tab === "ranking" ? loading : heatLoading} fetching={fetching}
      csv={tab === "ranking" ? stats : heatData} csvName={tab === "ranking" ? `ranking-${rank}.csv` : `heatmap-${rank}-quarter.csv`}
      desc={tab === "ranking" ? "Median price per m², the change over the Period and the quarterly trend." : "The median price per m² of each quarter, on the same colour scale as the map."}
      controls={<>
        <Segmented role="tablist" label="View" testId="areas-tab" value={tab}
          onChange={(v) => { if (v !== tab) track("change-compare-view", { view: v }); setTab(v); }}
          options={[["ranking", "Ranking"], ["quarters", "Quarter by quarter"]]} />
        <span className="flex items-center gap-2 sm:ml-auto">
        <label htmlFor={groupId} className="text-[14px] font-medium">Group</label>
        <span className="relative inline-flex">
          <select id={groupId} value={rank} data-testid="rank-switch"
            onChange={(e) => onRank(e.target.value as RankGroup)}
            className="appearance-none h-10 pl-3 pr-9 rounded-lg border border-control bg-card text-[15px] font-medium">
            {RANK_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" aria-hidden />
        </span>
        </span>
      </>}>
      {tab === "ranking"
        ? <Ranking stats={stats} trend={trend} loading={loading} error={error} retry={retry} scale={scale} selId={selId} onSelect={onSelect} ptype={ptype} isDark={isDark} />
        : <Heatmap data={heatData} rows={rows} loading={heatLoading} error={heatError} retry={retryHeat} scale={scale.color} domain={domain} selId={selId}
            onSelectRow={onSelectRow} rank={rank} ptype={ptype} travel={travel} onSelectPeriod={onSelectPeriod} />}
    </ChartCard>
  );
});
