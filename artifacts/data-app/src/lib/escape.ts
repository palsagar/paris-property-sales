/** Escapes text for use inside an HTML string, such as a Leaflet tooltip. DVF text is unchecked input. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
