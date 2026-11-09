import { endOfMonth, monthsBefore, monthsBetween } from "./fmt";

const month = (date: string) => date.slice(0, 7);

// A saved link can name dates that a newer DVF release no longer covers. This
// moves the Period to the nearest dates the data covers. It compares months,
// because the first Sale is rarely on the first day of a month.
export function nearestValidPeriod(
  from: string | undefined,
  to: string | undefined,
  datasetFrom: string,
  datasetTo: string,
): { from?: string; to?: string; moved: boolean } {
  // A reversed Period reads as the same months in order: from the first day of the earlier month to the end of the later.
  if (from && to && month(from) > month(to)) [from, to] = [`${month(to)}-01`, endOfMonth(from)];

  const start = from ?? datasetFrom;
  const end = to ?? datasetTo;
  const length = Math.max(1, monthsBetween(start, end));

  // Wholly outside the data: keep the length in months at the nearest end of the data.
  if (month(end) < month(datasetFrom)) {
    const last = endOfMonth(monthsBefore(datasetFrom, -(length - 1)));
    return { from: datasetFrom, to: last < datasetTo ? last : datasetTo, moved: true };
  }
  if (month(start) > month(datasetTo)) {
    const first = monthsBefore(datasetTo, length - 1);
    return { from: first > datasetFrom ? first : datasetFrom, to: datasetTo, moved: true };
  }

  // Overlapping the data: move only the bound that is outside.
  const newFrom = from && month(from) < month(datasetFrom) ? datasetFrom : from;
  const newTo = to && month(to) > month(datasetTo) ? datasetTo : to;
  return { from: newFrom, to: newTo, moved: newFrom !== from || newTo !== to };
}

// In the Year view, a Partial year must show its months, such as "2021, Jul–Dec". The trend
// bucket only carries the plain year, so this takes the label from the dataset's year ranges.
export function yearBucketLabel(period: string, label: string, years: { label: string; from: string }[]): string {
  return years.find((y) => y.from.slice(0, 4) === period.slice(0, 4))?.label ?? label;
}
