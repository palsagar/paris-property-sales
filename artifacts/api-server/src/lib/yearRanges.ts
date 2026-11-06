export interface YearRange {
  label: string;
  from: string;
  to: string;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * One range per calendar year of the data, oldest first. The first range
 * starts at datasetFrom and the last ends at datasetTo. A year that does not
 * run from January to December is Partial and its label names its months.
 */
export function yearRanges(datasetFrom: string, datasetTo: string): YearRange[] {
  const firstYear = Number(datasetFrom.slice(0, 4));
  const lastYear = Number(datasetTo.slice(0, 4));
  const ranges: YearRange[] = [];
  for (let year = firstYear; year <= lastYear; year++) {
    const from = year === firstYear ? datasetFrom : `${year}-01-01`;
    const to = year === lastYear ? datasetTo : `${year}-12-31`;
    const first = Number(from.slice(5, 7));
    const last = Number(to.slice(5, 7));
    let label = String(year);
    if (first !== 1 || last !== 12) {
      const months =
        first === last ? MONTHS[first - 1] : `${MONTHS[first - 1]}–${MONTHS[last - 1]}`;
      label = `${year}, ${months}`;
    }
    ranges.push({ label, from, to });
  }
  return ranges;
}
