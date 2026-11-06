import { useMemo, useState } from "react";
import { Search, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { DEPARTMENT_NAMES, searchScore, searchValue, type Area, type DepartmentId, type RankGroup } from "@/lib/areas";
import { arrLabel } from "@/lib/fmt";

export type QMeta = { id: string; name: string; arr: number };
export type CommuneMeta = { id: string; name: string; group: RankGroup };

type Option = { id: string; name: string; area: Area };
const DEPARTMENTS = Object.entries(DEPARTMENT_NAMES) as [DepartmentId, string][];
const departmentOption = ([id, name]: [DepartmentId, string]): Option => ({ id, name, area: { kind: "department", id } });

export function AreaSearch({ quartiers, communes, area, onSelect }: { quartiers: QMeta[]; communes: CommuneMeta[]; area: Area; onSelect: (a: Area) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const groups = useMemo(() => {
    const qOption = (q: QMeta): Option => ({ id: q.id, name: q.name, area: { kind: "q", id: q.id } });
    const communesOf = (group: RankGroup) => communes.filter((c) => c.group === group).map((c): Option => ({ id: c.id, name: c.name, area: { kind: "commune", id: c.id } }));
    const arrs = [...new Set(quartiers.map((q) => q.arr))].sort((a, b) => a - b);
    const out: [string, Option[]][] = [
      ["Departments", DEPARTMENTS.map(departmentOption)],
      ...arrs.map((arr): [string, Option[]] => [`${arrLabel(arr)} arrondissement`, quartiers.filter((q) => q.arr === arr).map(qOption)]),
      ...DEPARTMENTS.map(([id, name]): [string, Option[]] => [`Communes in ${name}`, communesOf(id)]),
      ["Major towns", communesOf("major")],
    ];
    return out;
  }, [quartiers, communes]);
  // The search component sorts the items inside a group but not the groups, so a typed text puts the group with the best match first.
  const shownGroups = useMemo(() => {
    if (!search) return groups;
    const best = (options: Option[]) => Math.max(...options.map((o) => searchScore(searchValue(o.name, o.id), search)));
    return groups.map((g) => [g, best(g[1])] as const).sort((a, b) => b[1] - a[1]).map(([g]) => g);
  }, [groups, search]);
  const selected = area.kind === "department" || area.kind === "q" || area.kind === "commune" ? area.id : undefined;
  const cur = groups.flatMap(([, options]) => options).find((o) => o.id === selected);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSearch(""); }}>
      <PopoverTrigger asChild>
        <button data-testid="button-area-search" className={`h-7 px-2.5 rounded-md border text-[13px] flex items-center gap-1.5 transition-colors ${cur ? "border-primary/50 text-primary bg-primary/5" : "bg-card hover:bg-muted"}`}>
          <Search className="w-3.5 h-3.5" />{cur ? cur.name : "Find a quartier or commune"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[300px]" align="start">
        <Command filter={searchScore}>
          <CommandInput value={search} onValueChange={setSearch} placeholder="Search quartiers and communes..." data-testid="input-area-search" />
          <CommandList className="max-h-[340px]">
            <CommandEmpty>Nothing matches that name.</CommandEmpty>
            {shownGroups.map(([heading, options]) => (
              <CommandGroup key={heading} heading={heading}>
                {options.map((o) => (
                  <CommandItem key={o.id} value={searchValue(o.name, o.id)} onSelect={() => { onSelect(o.area); setOpen(false); }} data-testid={`option-area-${o.id}`}>
                    <span className="flex-1">{o.name}</span>
                    {o.id === selected && <Check className="w-3.5 h-3.5 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
