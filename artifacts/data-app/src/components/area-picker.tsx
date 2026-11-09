import { useId, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { DEPARTMENT_NAMES, arrPostcode, arrSearchTerms, searchScore, searchValue, type Area, type DepartmentId, type RankGroup } from "@/lib/areas";
import { arrLabel } from "@/lib/fmt";
import { t } from "@/lib/i18n/messages";

export type QMeta = { id: string; name: string; arr: number };
export type CommuneMeta = { id: string; name: string; group: RankGroup };

/** `extra`: other words the search matches, such as an Arrondissement's number and postcode. */
type Option = { id: string; name: string; context?: string; extra?: string; area: Area };
const DEPARTMENTS = Object.entries(DEPARTMENT_NAMES) as [DepartmentId, string][];
const departmentOption = ([id, name]: [DepartmentId, string]): Option => ({ id, name, area: { kind: "department", id } });

const tileCls = (on: boolean, near = false) =>
  `h-10 rounded-lg border text-[15px] font-medium transition-colors ${on ? "bg-foreground text-background border-foreground" : near ? "border-foreground bg-card" : "border-border bg-card hover:bg-sunken"}`;

/**
 * Chooses an Area. Empty, it shows Paris and its 20 Arrondissements as tiles and the three Departments. Typed, it
 * searches All Paris, every Arrondissement (by number, postcode or name), Department, Quartier, Commune and Major
 * town. It is the body of the Area popover on a laptop and of the Selection sheet on a phone. `onSelect` reports the
 * control used, for analytics: tiles are "buttons". `arrNames` holds each Arrondissement's own name, such as Popincourt.
 */
export function AreaPicker({ quartiers, communes, arrNames, area, selArr, onSelect, autoFocus = false }: {
  quartiers: QMeta[]; communes: CommuneMeta[]; arrNames: Map<number, string>; area: Area; selArr?: number;
  onSelect: (a: Area, via: "buttons" | "search") => void; autoFocus?: boolean;
}) {
  const inputId = useId();
  const [search, setSearch] = useState("");
  const groups = useMemo(() => {
    const qOption = (q: QMeta): Option => ({ id: q.id, name: q.name, context: arrLabel(q.arr), area: { kind: "q", id: q.id } });
    const communesOf = (group: RankGroup) => communes.filter((c) => c.group === group).map((c): Option => ({ id: c.id, name: c.name, area: { kind: "commune", id: c.id } }));
    const arrs = [...new Set(quartiers.map((q) => q.arr))].sort((a, b) => a - b);
    const p = t().picker;
    const arrOption = (n: number): Option => ({ id: arrPostcode(n), name: `${arrLabel(n)} arrondissement`, context: arrNames.get(n), extra: arrSearchTerms(n, arrNames.get(n)), area: { kind: "arr", arr: n } });
    const out: [string, Option[]][] = [
      ["Paris", [{ id: "paris", name: t().fmt.allParis, area: { kind: "paris" } }, ...Array.from({ length: 20 }, (_, i) => arrOption(i + 1))]],
      [p.departments, DEPARTMENTS.map(departmentOption)],
      ...arrs.map((arr): [string, Option[]] => [p.quartiersOf(arrLabel(arr)), quartiers.filter((q) => q.arr === arr).map(qOption)]),
      ...DEPARTMENTS.map(([id, name]): [string, Option[]] => [p.communesIn(name), communesOf(id)]),
      [p.majorTowns, communesOf("major")],
    ];
    return out;
  }, [quartiers, communes, arrNames]);
  // The search component sorts the items inside a group but not the groups, so a typed text puts the group with the best match first.
  const shownGroups = useMemo(() => {
    if (!search) return groups;
    const best = (options: Option[]) => Math.max(...options.map((o) => searchScore(searchValue(o.name, o.id, o.extra), search)));
    return groups.map((g) => [g, best(g[1])] as const).sort((a, b) => b[1] - a[1]).map(([g]) => g);
  }, [groups, search]);
  const tx = t();
  const selected = JSON.stringify(area);

  return (
    <Command filter={searchScore} className="bg-transparent overflow-visible" data-testid="area-picker">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-[14px] font-medium">{tx.picker.find}</label>
        <div className="rounded-lg border border-control bg-background focus-within:ring-2 focus-within:ring-ring [&_[cmdk-input-wrapper]]:border-0">
          <CommandInput id={inputId} value={search} onValueChange={setSearch} autoFocus={autoFocus}
            placeholder="11e, Odéon, Montreuil…" data-testid="input-area-search" className="h-11 text-[16px] md:text-[15px] focus-visible:outline-none" />
        </div>
      </div>
      {search ? (
        <CommandList className="max-h-[min(360px,50dvh)] mt-2 -mx-1">
          <CommandEmpty>{tx.picker.nothing}</CommandEmpty>
          {shownGroups.map(([heading, options]) => (
            <CommandGroup key={heading} heading={heading}>
              {options.map((o) => (
                <CommandItem key={o.id} value={searchValue(o.name, o.id, o.extra)} onSelect={() => onSelect(o.area, "search")} data-testid={`option-area-${o.id}`}
                  className="min-h-10 text-[15px]">
                  <span className="flex-1">{o.name}{o.context && <span className="text-muted-foreground"> · {o.context}</span>}</span>
                  {JSON.stringify(o.area) === selected && <Check className="w-4 h-4 text-primary" aria-label={tx.picker.selected} />}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      ) : (
        <div className="mt-4 flex flex-col gap-4">
          <section aria-labelledby={`${inputId}-paris`} className="flex flex-col gap-2">
            <h3 id={`${inputId}-paris`} className="text-[12px] font-semibold tracking-wide text-muted-foreground">PARIS</h3>
            <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Arrondissement">
              <button type="button" onClick={() => onSelect({ kind: "paris" }, "buttons")} aria-pressed={area.kind === "paris"} data-testid="filter-arr-all"
                className={`col-span-5 ${tileCls(area.kind === "paris")}`}>{tx.fmt.allParis}</button>
              {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => {
                const on = area.kind === "arr" && area.arr === n;
                return (
                  <button key={n} type="button" onClick={() => onSelect({ kind: "arr", arr: n }, "buttons")} aria-pressed={on} data-testid={`filter-arr-${n}`}
                    aria-label={`${arrLabel(n)} arrondissement${!on && selArr === n ? tx.picker.holdsQuartier : ""}`}
                    className={`font-num ${tileCls(on, !on && selArr === n)}`}>{arrLabel(n)}</button>
                );
              })}
            </div>
          </section>
          <section aria-labelledby={`${inputId}-around`} className="flex flex-col gap-2">
            <h3 id={`${inputId}-around`} className="text-[12px] font-semibold tracking-wide text-muted-foreground">{tx.picker.around}</h3>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={tx.picker.department}>
              {DEPARTMENTS.map(([id, name]) => {
                const on = area.kind === "department" && area.id === id;
                return <button key={id} type="button" onClick={() => onSelect({ kind: "department", id }, "buttons")} aria-pressed={on} data-testid={`filter-dept-${id}`}
                  className={`px-3 ${tileCls(on)}`}>{name}</button>;
              })}
            </div>
            <p className="text-[13px] text-muted-foreground">{tx.picker.hint}</p>
          </section>
        </div>
      )}
    </Command>
  );
}
