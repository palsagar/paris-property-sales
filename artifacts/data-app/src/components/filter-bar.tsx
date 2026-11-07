import { memo } from "react";
import type { PropertyTypeParameter, YearRange } from "@workspace/api-client-react";
import { TimeControl } from "@/components/time-control";
import { AreaSearch, type QMeta } from "@/components/area-picker";
import { arrLabel } from "@/lib/fmt";
import type { RankGroup } from "@/lib/areas";
import { useRequestedView } from "@/lib/shown-view";
import type { ViewState } from "@/lib/view-state";

/**
 * The sticky Selection controls. They read the requested view, so a click shows at once, while the panels below
 * keep the shown view until its data has loaded.
 */
export const FilterBar = memo(function FilterBar({ chartView, datasetFrom, datasetTo, years, isDark, quartiers, communes, qById }: {
  chartView: Pick<ViewState, "ptype" | "area">; datasetFrom: string; datasetTo: string; years: YearRange[]; isDark: boolean;
  quartiers: QMeta[]; communes: { id: string; name: string; group: RankGroup }[]; qById: Map<string, QMeta>;
}) {
  const { view, patch, selectArea, updating } = useRequestedView();
  const { ptype, area, from, to } = view;
  const selArr = area.kind === "arr" ? area.arr : area.kind === "q" ? qById.get(area.id)?.arr : undefined;
  const selectArr = (arr: number) => selectArea({ kind: "arr", arr });

  return (
    <div className="md:sticky top-0 z-[500] -mx-4 md:-mx-6 px-4 md:px-6 py-2 mb-3 bg-background border-b space-y-2 print:static">
      <TimeControl chartView={chartView} from={from} to={to} datasetFrom={datasetFrom} datasetTo={datasetTo} years={years}
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
            <button onClick={() => selectArea({ kind: "paris" })} data-testid="filter-arr-all" aria-pressed={area.kind === "paris"} className={`px-2 h-7 text-[13px] rounded transition-colors ${area.kind === "paris" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>Paris</button>
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
              <button key={n} onClick={() => selectArr(n)} data-testid={`filter-arr-${n}`} aria-pressed={area.kind === "arr" && area.arr === n} aria-label={`${arrLabel(n)} arrondissement`}
                className={`w-7 h-7 text-[12.5px] font-num rounded transition-colors ${area.kind === "arr" && area.arr === n ? "bg-primary text-primary-foreground" : selArr === n ? "ring-1 ring-primary text-primary" : "hover:bg-muted"}`}>{n}</button>
            ))}
          </div>
          <AreaSearch quartiers={quartiers} communes={communes} area={area} onSelect={selectArea} />
        </div>
      </div>
      <div className="fixed top-2 right-2 z-[1000] pointer-events-none print:hidden" aria-live="polite">
        {updating && (
          <span className="updating-label rounded-md border bg-card px-2.5 py-1 text-[13px] text-muted-foreground shadow-sm" data-testid="text-updating">Updating</span>
        )}
      </div>
    </div>
  );
});
