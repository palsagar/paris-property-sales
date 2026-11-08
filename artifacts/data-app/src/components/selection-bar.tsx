import { memo, useState } from "react";
import type { PropertyTypeParameter, YearRange } from "@workspace/api-client-react";
import { CalendarDays, Loader2, MapPin, SlidersHorizontal, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle, DrawerTrigger } from "@/components/ui/drawer";
import { TimeControl } from "@/components/time-control";
import { AreaPicker, type CommuneMeta, type QMeta } from "@/components/area-picker";
import { FieldButton, Segmented, iconBtnCls, primaryBtnCls } from "@/components/ui-bits";
import { arrLabel, monthsBefore, num, rangeLabel } from "@/lib/fmt";
import { DEPARTMENT_NAMES, type Area } from "@/lib/areas";
import { useRequestedView } from "@/lib/shown-view";
import { track, typeName } from "@/lib/analytics";
import type { ViewState } from "@/lib/view-state";

const TYPES: [PropertyTypeParameter, string][] = [["all", "All homes"], ["Appartement", "Apartments"], ["Maison", "Houses"]];

/** The name of any Area, from the names the page already has. */
export function areaLabel(a: Area, qById: Map<string, QMeta>, communes: CommuneMeta[]): string {
  switch (a.kind) {
    case "paris": return "All Paris";
    case "arr": return `${arrLabel(a.arr)} arrondissement`;
    case "q": return qById.get(a.id)?.name ?? "Quartier";
    case "commune": return communes.find((c) => c.id === a.id)?.name ?? "Commune";
    case "department": return DEPARTMENT_NAMES[a.id];
  }
}

/** The Period in words: a preset's name when it is one, else its months. */
export function periodLabel(from: string | undefined, to: string | undefined, datasetFrom: string, datasetTo: string, years: YearRange[], short = false): string {
  if (!from && !to) return short ? "All dates" : `All dates · ${rangeLabel(datasetFrom, datasetTo)}`;
  const year = years.find((y) => y.from === from && y.to === to);
  if (year) return year.label;
  if (from === monthsBefore(datasetTo, 11) && to === datasetTo) return short ? "Last 12 months" : `Last 12 months · ${rangeLabel(from, to)}`;
  return rangeLabel(from ?? datasetFrom, to ?? datasetTo);
}

/**
 * The Selection bar: Area, property type and Period, pinned to the top of the screen at every width. It reads the
 * requested view, so a choice shows at once, while the panels below keep the shown view until its data has loaded.
 * On a laptop, Area and Period open popovers. On a phone, one button opens a sheet with all three.
 */
export const SelectionBar = memo(function SelectionBar({ chartView, datasetFrom, datasetTo, years, isDark, quartiers, communes, qById, count }: {
  chartView: Pick<ViewState, "ptype" | "area">; datasetFrom: string; datasetTo: string; years: YearRange[]; isDark: boolean;
  quartiers: QMeta[]; communes: CommuneMeta[]; qById: Map<string, QMeta>;
  /** Sales in the shown Selection, once loaded. */
  count?: number;
}) {
  const { view, patch, selectArea, updating } = useRequestedView();
  const { ptype, area, from, to } = view;
  const [areaOpen, setAreaOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const selArr = area.kind === "arr" ? area.arr : area.kind === "q" ? qById.get(area.id)?.arr : undefined;
  const name = areaLabel(area, qById, communes);
  const period = periodLabel(from, to, datasetFrom, datasetTo, years);
  const typeText = TYPES.find(([v]) => v === ptype)![1];
  const setType = (v: PropertyTypeParameter) => { if (v !== ptype) track("select-property-type", { type: typeName(v) }); patch({ ptype: v }); };
  const setPeriod = (f?: string, t?: string) => patch({ from: f, to: t });
  const status = updating ? "Updating" : count != null ? `${num(count)} sales` : "";

  return (
    <div className="sticky top-0 z-30 -mx-4 md:-mx-8 bg-background border-y print:hidden" data-testid="selection-bar">
      {/* Laptop and tablet */}
      <div className="hidden md:flex flex-wrap items-center gap-x-3 gap-y-2 px-8 py-2.5">
        <Popover open={areaOpen} onOpenChange={setAreaOpen}>
          <PopoverTrigger asChild>
            <FieldButton icon={<MapPin className="w-[18px] h-[18px]" />} label="Area" value={name} className="w-[min(300px,32vw)]" data-testid="button-area" aria-haspopup="dialog" />
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={8} className="w-[440px] p-4 rounded-xl data-[state=closed]:animate-none" aria-label="Choose an area">
            <AreaPicker quartiers={quartiers} communes={communes} area={area} selArr={selArr} autoFocus
              onSelect={(a, via) => { selectArea(a, via); setAreaOpen(false); }} />
          </PopoverContent>
        </Popover>
        <Segmented label="Property type" testId="filter-type" value={ptype} onChange={setType} options={TYPES} className="h-[52px] items-center px-1" />
        <Popover open={periodOpen} onOpenChange={setPeriodOpen}>
          <PopoverTrigger asChild>
            <FieldButton icon={<CalendarDays className="w-[18px] h-[18px]" />} label="Period" className="w-[min(340px,34vw)]" data-testid="button-period" aria-haspopup="dialog"
              value={<><span className="hidden xl:inline">{period}</span><span className="xl:hidden">{periodLabel(from, to, datasetFrom, datasetTo, years, true)}</span></>} />
          </PopoverTrigger>
          <PopoverContent align="start" sideOffset={8} className="w-[540px] max-w-[calc(100vw-32px)] p-4 rounded-xl" aria-label="Choose a period">
            <TimeControl chartView={chartView} from={from} to={to} datasetFrom={datasetFrom} datasetTo={datasetTo} years={years}
              onChange={setPeriod} isDark={isDark} status={status} />
          </PopoverContent>
        </Popover>
        <p role="status" aria-live="polite" className="ml-auto flex items-center gap-2 text-[14px] text-muted-foreground">
          {updating ? <span className="updating-label inline-flex items-center gap-2" data-testid="text-updating"><Loader2 className="w-4 h-4 animate-spin text-primary" aria-hidden />Updating</span>
            : count != null ? <><span className="font-num font-medium text-foreground">{num(count)}</span>sales in this Selection</> : null}
        </p>
      </div>

      {/* Phone */}
      <div className="md:hidden px-4 py-2">
        <Drawer open={sheetOpen} onOpenChange={setSheetOpen} shouldScaleBackground={false}>
          <DrawerTrigger asChild>
            <button type="button" className="w-full min-h-14 flex items-center gap-3 pl-3.5 pr-2 py-1.5 rounded-[10px] border border-control bg-card text-left" data-testid="button-selection" aria-haspopup="dialog">
              <MapPin className="w-5 h-5 text-primary shrink-0" aria-hidden />
              <span className="flex flex-col min-w-0 flex-1 leading-snug">
                <span className="text-[16px] font-semibold truncate">{name}</span>
                <span className="text-[14px] text-muted-foreground truncate">{typeText} · {periodLabel(from, to, datasetFrom, datasetTo, years, true)}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 h-11 px-2.5 rounded-lg bg-foreground text-background text-[14px] font-medium shrink-0">
                <SlidersHorizontal className="w-4 h-4" aria-hidden />Change
              </span>
            </button>
          </DrawerTrigger>
          <DrawerContent className="max-h-[92dvh] bg-card rounded-t-2xl shadow-lg" aria-describedby="selection-sheet-desc">
            <div className="flex items-center justify-between pl-4 pr-2 pt-1 pb-2 border-b">
              <DrawerTitle className="font-display text-[20px] font-bold tracking-normal">Choose what to show</DrawerTitle>
              <DrawerClose className={iconBtnCls} aria-label="Close"><X className="w-[22px] h-[22px]" aria-hidden /></DrawerClose>
            </div>
            <DrawerDescription id="selection-sheet-desc" className="sr-only">Choose an area, a property type and a period. The page behind updates as you choose.</DrawerDescription>
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-6 flex flex-col gap-7" data-vaul-no-drag>
              <fieldset className="flex flex-col gap-2">
                <legend className="text-[13px] font-semibold tracking-wide text-muted-foreground mb-2">AREA</legend>
                <AreaPicker quartiers={quartiers} communes={communes} area={area} selArr={selArr} onSelect={(a, via) => selectArea(a, via)} />
              </fieldset>
              <fieldset>
                <legend className="text-[13px] font-semibold tracking-wide text-muted-foreground mb-2">PROPERTY</legend>
                <Segmented label="Property type" testId="sheet-type" value={ptype} onChange={setType} options={TYPES} stretch tall />
              </fieldset>
              <fieldset>
                <legend className="text-[13px] font-semibold tracking-wide text-muted-foreground mb-2">PERIOD</legend>
                <TimeControl chartView={chartView} from={from} to={to} datasetFrom={datasetFrom} datasetTo={datasetTo} years={years}
                  onChange={setPeriod} isDark={isDark} tall />
              </fieldset>
            </div>
            <div className="px-4 pt-3 pb-[max(16px,env(safe-area-inset-bottom))] border-t flex flex-col gap-2">
              <p className="text-[14px] text-muted-foreground text-center">The page behind updates as you choose.</p>
              <DrawerClose className={primaryBtnCls} data-testid="button-sheet-done">
                {updating ? "Updating…" : count != null ? `Show ${num(count)} sales` : "Done"}
              </DrawerClose>
            </div>
          </DrawerContent>
        </Drawer>
      </div>

      {updating && (
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden" aria-hidden>
          <div className="progress-line h-full w-2/5 bg-primary" />
        </div>
      )}
    </div>
  );
});
