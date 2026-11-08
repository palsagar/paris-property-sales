/**
 * The link preview tags that need the site's public address. WhatsApp and similar apps read only absolute URLs, so the
 * server adds these tags to index.html at startup, from SITE_URL, the same way it adds the Umami tag (lib/umami.ts).
 */

const NO_IMAGE = "link previews have no image";

/** The public origin, such as https://parism2.gpuphysics.dev, without a trailing slash. "" when SITE_URL is not usable. */
export function siteUrl(env: Record<string, string | undefined>): { url: string; warning?: string } {
  const raw = env["SITE_URL"]?.trim() ?? "";
  if (!raw) return { url: "", warning: `SITE_URL is not set, so ${NO_IMAGE}.` };
  // The value goes into HTML attributes, so it may not hold quotes, angle brackets, ampersands or spaces.
  if (/[\s"'<>&]/.test(raw)) return { url: "", warning: `SITE_URL holds quotes, angle brackets or spaces, so ${NO_IMAGE}.` };
  let u: URL;
  try { u = new URL(raw); } catch { return { url: "", warning: `SITE_URL is not a URL, so ${NO_IMAGE}.` }; }
  if (u.protocol !== "https:") return { url: "", warning: `SITE_URL is not an https URL, so ${NO_IMAGE}.` };
  if (u.pathname !== "/" || u.search || u.hash || u.username || u.password) return { url: "", warning: `SITE_URL has more than an origin, so ${NO_IMAGE}.` };
  return { url: u.origin };
}

const ALT = "Map of Paris and its suburbs coloured by price per m² · Carte de Paris et alentours colorée selon le prix au m²";

/** The absolute preview tags for the site at `url`, or "" without a url. */
export function previewTags(url: string): string {
  if (!url) return "";
  const image = `${url}/og-image.png`;
  return [
    `<meta property="og:url" content="${url}/">`,
    `<meta property="og:image" content="${image}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="${ALT}">`,
    `<meta name="twitter:image" content="${image}">`,
  ].join("");
}
