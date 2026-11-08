/** Escapes text for use inside an HTML string, such as a Leaflet tooltip. DVF text is unchecked input. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

const FORMULA_START = /^[=+\-@\t\r]/;
const NUMBER = /^[+-]?\d+(\.\d+)?$/;

/**
 * The rows of a CSV export, with a single quote before any text a spreadsheet would read as a formula: text that starts
 * with = + - @, a tab or a carriage return. Numbers, and text that is only a number such as "-12.5", stay as they are.
 */
export function csvSafe(rows: object[]): object[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === "string" && FORMULA_START.test(value) && !NUMBER.test(value) ? `'${value}` : value,
      ]),
    ),
  );
}
