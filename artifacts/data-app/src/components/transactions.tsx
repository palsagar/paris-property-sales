import { useEffect, useState } from "react";
import { useListTransactions, getListTransactionsQueryKey, type ListTransactionsSortBy, type ListTransactionsSortDir } from "@workspace/api-client-react";
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard, ErrorState } from "@/components/ui-bits";
import { eur, sqm, num, dateLabel } from "@/lib/fmt";
import { keepInSameArea, saleArea, type Area } from "@/lib/areas";
import type { Filters } from "@/components/hero-trend";

const COLS: { key: string; label: string; sort?: ListTransactionsSortBy; right?: boolean }[] = [
  { key: "date", label: "Date", sort: "date" }, { key: "address", label: "Street" }, { key: "area", label: "Area" }, { key: "quartier", label: "Quartier" },
  { key: "type", label: "Type" }, { key: "rooms", label: "Rooms", right: true }, { key: "surface", label: "Surface", sort: "surface", right: true },
  { key: "price", label: "Price", sort: "price", right: true }, { key: "ppsqm", label: "Price / m²", sort: "pricePerSqm", right: true },
];
const PAGE = 15;

export function Transactions({ filters, scopeLabel, scale, areaColor, onSelectArea, onSelectQuartierName, isDark }: {
  filters: Filters; scopeLabel: string; scale: (v: number) => string; areaColor: (id: string) => string;
  onSelectArea: (a: Area) => void; onSelectQuartierName: (name: string) => void; isDark: boolean;
}) {
  const [sortBy, setSortBy] = useState<ListTransactionsSortBy>("date");
  const [sortDir, setSortDir] = useState<ListTransactionsSortDir>("desc");
  const [page, setPage] = useState(0);
  const fk = JSON.stringify(filters);
  useEffect(() => setPage(0), [fk, sortBy, sortDir]);
  const p = { ...filters, sortBy, sortDir, limit: PAGE, offset: page * PAGE };
  const tx = useListTransactions(p, { query: { queryKey: getListTransactionsQueryKey(p), placeholderData: keepInSameArea(filters) } });
  const totalPages = tx.data ? Math.max(1, Math.ceil(tx.data.total / PAGE)) : 1;

  return (
    <ChartCard testId="transactions" title="Sales list" isDark={isDark} loading={tx.isLoading} fetching={tx.isFetching}
      desc={tx.data ? `${num(tx.data.total)} transactions, ${scopeLabel}` : "Individual sales in this selection."} csv={tx.data?.items} csvName="transactions.csv">
      {tx.isError ? <ErrorState onRetry={() => tx.refetch()} /> : (
        <>
          <div className={`overflow-x-auto rounded-md border transition-opacity ${tx.isFetching && !tx.isLoading ? "opacity-60" : ""}`}>
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  {COLS.map((col) => (
                    <th key={col.key} className={`px-3 py-2 text-[12.5px] font-medium text-muted-foreground whitespace-nowrap ${col.right ? "text-right" : "text-left"}`}>
                      {col.sort ? (
                        <button data-testid={`sort-${col.key}`} className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${sortBy === col.sort ? "text-foreground" : ""}`}
                          onClick={() => { if (sortBy === col.sort) setSortDir(sortDir === "asc" ? "desc" : "asc"); else { setSortBy(col.sort!); setSortDir("desc"); } }}>
                          {col.label}{sortBy === col.sort && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </button>
                      ) : col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tx.isLoading ? Array.from({ length: PAGE }).map((_, i) => (
                  <tr key={i} className="border-t"><td colSpan={COLS.length} className="px-3 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : tx.data?.items.length ? tx.data.items.map((t) => { const a = saleArea(t); return (
                  <tr key={t.id} className="border-t hover:bg-muted/40 transition-colors" data-testid={`row-tx-${t.id}`}>
                    <td className="px-3 py-2 whitespace-nowrap font-num text-[13px]">{dateLabel(t.date)}</td>
                    <td className="px-3 py-2 max-w-[280px] truncate" title={t.address}>{t.address}</td>
                    <td className="px-3 py-2">
                      <button onClick={() => onSelectArea(a.area)} className="inline-flex items-center gap-1.5 hover:underline text-left">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: areaColor(a.id) }} />{a.label}
                      </button>
                    </td>
                    <td className="px-3 py-2 max-w-[180px] truncate">
                      {t.quartierName ? <button onClick={() => onSelectQuartierName(t.quartierName!)} className="hover:underline hover:text-primary text-left">{t.quartierName}</button> : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-3 py-2"><span className={`text-[11.5px] px-1.5 py-0.5 rounded ${t.type === "Maison" ? "bg-primary/10 text-primary" : "bg-muted"}`}>{t.type === "Maison" ? "House" : "Apartment"}</span></td>
                    <td className="px-3 py-2 text-right font-num text-[13px]">{t.rooms}</td>
                    <td className="px-3 py-2 text-right font-num text-[13px] whitespace-nowrap">{num(t.surface)} m²</td>
                    <td className="px-3 py-2 text-right font-num text-[13px] whitespace-nowrap">{eur(t.price)}</td>
                    <td className="px-3 py-2 text-right font-num text-[13px] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: scale(t.pricePerSqm) }} />{sqm(t.pricePerSqm)}</span>
                    </td>
                  </tr>
                ); }) : (
                  <tr><td colSpan={COLS.length} className="px-3 py-12 text-center text-muted-foreground">No sales match this selection. Try a longer period or another area.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between mt-3 text-[13px] print:hidden">
            <span className="text-muted-foreground">{tx.data && tx.data.total > 0 ? `${num(page * PAGE + 1)}-${num(Math.min((page + 1) * PAGE, tx.data.total))} of ${num(tx.data.total)}` : ""}</span>
            <div className="flex items-center gap-1.5">
              <button disabled={page === 0} onClick={() => setPage((x) => x - 1)} data-testid="button-prev" aria-label="Previous page" className="h-7 w-7 flex items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
              <span className="font-num px-2">{page + 1} / {num(totalPages)}</span>
              <button disabled={page + 1 >= totalPages} onClick={() => setPage((x) => x + 1)} data-testid="button-next" aria-label="Next page" className="h-7 w-7 flex items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        </>
      )}
    </ChartCard>
  );
}
