import { useMemo, useState } from "react";
import { Search, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { arrLabel } from "@/lib/fmt";

export type QMeta = { id: string; name: string; arr: number };

export function QuartierPicker({ quartiers, selected, onSelect }: { quartiers: QMeta[]; selected?: string; onSelect: (q: QMeta) => void }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => {
    const g = new Map<number, QMeta[]>();
    for (const q of quartiers) { const a = g.get(q.arr) ?? []; a.push(q); g.set(q.arr, a); }
    return [...g.entries()].sort((a, b) => a[0] - b[0]);
  }, [quartiers]);
  const cur = quartiers.find((q) => q.id === selected);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button data-testid="button-quartier-picker" className={`h-7 px-2.5 rounded-md border text-[13px] flex items-center gap-1.5 transition-colors ${cur ? "border-primary/50 text-primary bg-primary/5" : "bg-card hover:bg-muted"}`}>
          <Search className="w-3.5 h-3.5" />{cur ? cur.name : "Find a quartier"}
        </button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[300px]" align="start">
        <Command>
          <CommandInput placeholder="Search 80 quartiers..." data-testid="input-quartier-search" />
          <CommandList className="max-h-[340px]">
            <CommandEmpty>No quartier matches that name.</CommandEmpty>
            {groups.map(([arr, qs]) => (
              <CommandGroup key={arr} heading={`${arrLabel(arr)} arrondissement`}>
                {qs.map((q) => (
                  <CommandItem key={q.id} value={`${q.name} ${arr}`} onSelect={() => { onSelect(q); setOpen(false); }} data-testid={`option-quartier-${q.id}`}>
                    <span className="flex-1">{q.name}</span>
                    {q.id === selected && <Check className="w-3.5 h-3.5 text-primary" />}
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
