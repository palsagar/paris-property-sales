import { memo, useState } from "react";
import { useListTransactions, getListTransactionsQueryKey, type ListTransactionsSortBy } from "@workspace/api-client-react";
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard, ErrorState, outlineBtnCls } from "@/components/ui-bits";
import { eur, sqm, num, dateLabel, inArea } from "@/lib/fmt";
import { keepInSameArea, saleArea, type Area } from "@/lib/areas";
import { summaryParams, transactionParams, TRANSACTIONS_PAGE as PAGE, type Selection } from "@/lib/selection-queries";
import { usePanelChoices } from "@/lib/shown-view";
import { track } from "@/lib/analytics";
import { t } from "@/lib/i18n/messages";

/** The orders a phone offers in one menu, instead of tapping column heads. */
const SORTS: [string, ListTransactionsSortBy, "asc" | "desc"][] = [
  ["date-desc", "date", "desc"], ["date-asc", "date", "asc"], ["price-desc", "price", "desc"], ["price-asc", "price", "asc"],
  ["pricePerSqm-desc", "pricePerSqm", "desc"], ["pricePerSqm-asc", "pricePerSqm", "asc"], ["surface-desc", "surface", "desc"], ["surface-asc", "surface", "asc"],
];
const sortLabels = () => {
  const l = t().salesList;
  return [l.newest, l.oldest, l.priceHigh, l.priceLow, l.sqmHigh, l.sqmLow, l.surfaceLarge, l.surfaceSmall];
};

// "Date", "Quartier", "Type" and "Surface" are the same words in French.
const columns = (): { key: string; label: string; sort?: ListTransactionsSortBy; right?: boolean }[] => {
  const l = t().salesList;
  return [
    { key: "date", label: "Date", sort: "date" }, { key: "address", label: l.street }, { key: "area", label: l.area }, { key: "quartier", label: "Quartier" },
    { key: "type", label: "Type" }, { key: "rooms", label: l.rooms, right: true }, { key: "surface", label: "Surface", sort: "surface", right: true },
    { key: "price", label: l.price, sort: "price", right: true }, { key: "ppsqm", label: l.ppsqm, sort: "pricePerSqm", right: true },
  ];
};

export const Transactions = memo(function Transactions({ selection: view, scopeLabel, areaName, scale, areaColor, onSelectArea, onSelectQuartierName, isDark }: {
  selection: Selection; scopeLabel: string; areaName: string; scale: (v: number) => string; areaColor: (id: string) => string;
  onSelectArea: (a: Area) => void; onSelectQuartierName: (name: string) => void; isDark: boolean;
}) {
  const { choices, setChoices } = usePanelChoices();
  const { sortBy, sortDir } = choices;
  const filters = summaryParams(view);
  // The page belongs to one Selection and sort. A new one reads as the first page, so no request goes out for an old page.
  const key = JSON.stringify([filters, sortBy, sortDir]);
  const [held, setHeld] = useState({ key, page: 0 });
  // Forget the page of an earlier Selection, so coming back to it starts on the first page too.
  if (held.key !== key) setHeld({ key, page: 0 });
  const page = held.key === key ? held.page : 0;
  const setPage = (f: (x: number) => number) => setHeld({ key, page: f(page) });
  const sortOn = (by: ListTransactionsSortBy) => {
    const dir = sortBy === by && sortDir === "desc" ? "asc" : "desc";
    track("sort-sales", { column: by, dir });
    setChoices((c) => ({ ...c, sortBy: by, sortDir: dir }));
  };
  const p = transactionParams(view, choices, page * PAGE);
  const tx = useListTransactions(p, { query: { queryKey: getListTransactionsQueryKey(p), placeholderData: keepInSameArea(filters) } });
  const totalPages = tx.data ? Math.max(1, Math.ceil(tx.data.total / PAGE)) : 1;
  const sortKey = `${sortBy}-${sortDir}`;
  const sortTo = (key: string) => {
    const o = SORTS.find(([k]) => k === key);
    if (!o || key === sortKey) return;
    track("sort-sales", { column: o[1], dir: o[2] });
    setChoices((c) => ({ ...c, sortBy: o[1], sortDir: o[2] }));
  };
  // A single Arrondissement or Commune fills the Area column with one value, so it is left out.
  const showArea = view.area.kind === "paris" || view.area.kind === "department";
  const l = t().salesList;
  const cols = columns().filter((col) => col.key !== "area" || showArea);
  const pageLabel = tx.data && tx.data.total > 0 ? l.range(num(page * PAGE + 1), num(Math.min((page + 1) * PAGE, tx.data.total)), num(tx.data.total)) : "";
  const typeOf = (type: string) => (type === "Maison" ? l.house : l.apartment);

  return (
    <ChartCard testId="transactions" title={l.title(inArea(areaName))} isDark={isDark} loading={tx.isLoading} fetching={tx.isFetching}
      desc={l.desc(tx.data ? t().sales(num(tx.data.total), tx.data.total) : "", scopeLabel)} csv={tx.data?.items} csvName="transactions.csv">
      {tx.isError ? <ErrorState onRetry={() => tx.refetch()} /> : (
        <>
          {/* Phone: one card per Sale, sorted from a menu. */}
          <div className={`md:hidden transition-opacity ${tx.isFetching && !tx.isLoading ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2.5 mb-1">
              <label htmlFor="sales-sort" className="text-[15px] font-medium whitespace-nowrap">{l.sortBy}</label>
              <select id="sales-sort" value={sortKey} onChange={(e) => sortTo(e.target.value)} data-testid="select-sort-sales"
                className="flex-1 h-11 rounded-lg border border-control bg-card px-3 text-[16px]">
                {SORTS.map(([k], i) => <option key={k} value={k}>{sortLabels()[i]}</option>)}
              </select>
            </div>
            <ul data-testid="list-sales">
              {tx.isLoading ? Array.from({ length: 6 }).map((_, i) => <li key={i} className="py-3 border-t"><Skeleton className="h-14 w-full" /></li>)
                : tx.data?.items.length ? tx.data.items.map((t) => { const a = saleArea(t); return (
                  <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-3 border-t" data-testid={`card-tx-${t.id}`}>
                    <p className="text-[16px] font-semibold leading-snug">{t.address}</p>
                    <p className="font-num text-[15px] font-medium text-right whitespace-nowrap">{eur(t.price)}</p>
                    <p className="text-[14px] text-muted-foreground">
                      {t.quartierName ? <button type="button" onClick={() => onSelectQuartierName(t.quartierName!)} className="no-tap text-primary underline underline-offset-2">{t.quartierName}</button>
                        : showArea ? <button type="button" onClick={() => onSelectArea(a.area)} className="no-tap text-primary underline underline-offset-2">{a.label}</button> : null}
                      {(t.quartierName || showArea) && " · "}{dateLabel(t.date)}
                    </p>
                    <p className="font-num text-[13px] text-muted-foreground text-right whitespace-nowrap inline-flex items-center justify-end gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: scale(t.pricePerSqm) }} aria-hidden />{num(t.pricePerSqm)} /m²
                    </p>
                    <p className="col-span-2 text-[14px] text-muted-foreground">{typeOf(t.type)} · {l.roomCount(t.rooms)} · {num(t.surface)} m²</p>
                  </li>
                ); }) : <li className="py-10 text-center text-muted-foreground border-t">{l.empty}</li>}
            </ul>
          </div>
          {/* Laptop: the table. */}
          <div className={`hidden md:block overflow-x-auto rounded-lg border transition-opacity ${tx.isFetching && !tx.isLoading ? "opacity-60" : ""}`}>
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr>
                  {cols.map((col) => (
                    <th key={col.key} scope="col" aria-sort={col.sort && sortBy === col.sort ? (sortDir === "asc" ? "ascending" : "descending") : undefined} className={`px-3 py-2.5 text-[13px] font-medium text-muted-foreground whitespace-nowrap ${col.right ? "text-right" : "text-left"}`}>
                      {col.sort ? (
                        <button data-testid={`sort-${col.key}`} className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${sortBy === col.sort ? "text-foreground" : ""}`}
                          onClick={() => sortOn(col.sort!)}>
                          {col.label}{sortBy === col.sort && (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
                        </button>
                      ) : col.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tx.isLoading ? Array.from({ length: PAGE }).map((_, i) => (
                  <tr key={i} className="border-t"><td colSpan={cols.length} className="px-3 py-2"><Skeleton className="h-5 w-full" /></td></tr>
                )) : tx.data?.items.length ? tx.data.items.map((t) => { const a = saleArea(t); return (
                  <tr key={t.id} className="border-t hover:bg-muted/40 transition-colors" data-testid={`row-tx-${t.id}`}>
                    <td className="px-3 py-2.5 whitespace-nowrap font-num text-[14px]">{dateLabel(t.date)}</td>
                    <td className="px-3 py-2 max-w-[280px] truncate" title={t.address}>{t.address}</td>
                    {showArea && <td className="px-3 py-2">
                      <button onClick={() => onSelectArea(a.area)} className="inline-flex items-center gap-1.5 hover:underline text-left">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: areaColor(a.id) }} aria-hidden />{a.label}
                      </button>
                    </td>}
                    <td className="px-3 py-2 max-w-[180px] truncate">
                      {t.quartierName ? <button onClick={() => onSelectQuartierName(t.quartierName!)} className="hover:underline hover:text-primary text-left">{t.quartierName}</button> : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-3 py-2"><span className={`text-[13px] px-2 py-0.5 rounded ${t.type === "Maison" ? "bg-rise-bg text-rise" : "bg-sunken"}`}>{typeOf(t.type)}</span></td>
                    <td className="px-3 py-2 text-right font-num text-[13px]">{t.rooms}</td>
                    <td className="px-3 py-2 text-right font-num text-[13px] whitespace-nowrap">{num(t.surface)} m²</td>
                    <td className="px-3 py-2 text-right font-num text-[13px] whitespace-nowrap">{eur(t.price)}</td>
                    <td className="px-3 py-2 text-right font-num text-[13px] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[2px]" style={{ background: scale(t.pricePerSqm) }} aria-hidden />{sqm(t.pricePerSqm)}</span>
                    </td>
                  </tr>
                ); }) : (
                  <tr><td colSpan={cols.length} className="px-3 py-12 text-center text-muted-foreground">{l.empty}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <nav aria-label={l.pages} className="flex items-center justify-between gap-2 mt-3 text-[14px] print:hidden">
            <button disabled={page === 0} onClick={() => { track("page-sales", { page }); setPage((x) => x - 1); }} data-testid="button-prev" aria-label={l.previousPage} className={outlineBtnCls}>
              <ChevronLeft className="w-4 h-4" aria-hidden /><span className="hidden sm:inline">{l.previous}</span></button>
            <span className="font-num text-muted-foreground" aria-live="polite">{pageLabel}<span className="hidden sm:inline" data-testid="text-page">{l.page(page + 1, num(totalPages))}</span></span>
            <button disabled={page + 1 >= totalPages} onClick={() => { track("page-sales", { page: page + 2 }); setPage((x) => x + 1); }} data-testid="button-next" aria-label={l.nextPage} className={outlineBtnCls}>
              <span className="hidden sm:inline">{l.next}</span><ChevronRight className="w-4 h-4" aria-hidden /></button>
          </nav>
        </>
      )}
    </ChartCard>
  );
});
