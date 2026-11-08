import { readFileSync } from "node:fs";

/**
 * The Umami analytics tag. The server adds it to index.html only when UMAMI_SCRIPT_URL and UMAMI_WEBSITE_ID are set,
 * so local builds, tests and forks of the repository send nothing. The dashboard sends the page view itself
 * (lib/analytics.ts), without the query string, so the automatic page view is off.
 */

// Values go into an HTML attribute, so they may not hold quotes, angle brackets or spaces.
const PLAIN = /^[^\s"'<>&]+$/;
const ID = /^[A-Za-z0-9-]+$/;
const HOSTS = /^[A-Za-z0-9.-]+(,[A-Za-z0-9.-]+)*$/;

function isHttpUrl(v: string): boolean {
  if (!PLAIN.test(v)) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export function umamiTag(env: Record<string, string | undefined>): { tag: string; warning?: string } {
  const src = env["UMAMI_SCRIPT_URL"]?.trim() ?? "";
  const id = env["UMAMI_WEBSITE_ID"]?.trim() ?? "";
  const domains = (env["UMAMI_DOMAINS"] ?? "").split(",").map((d) => d.trim()).filter(Boolean).join(",");
  if (!src && !id) return { tag: "" };
  if (!src) return { tag: "", warning: "UMAMI_WEBSITE_ID is set without UMAMI_SCRIPT_URL, so the site sends no analytics." };
  if (!id) return { tag: "", warning: "UMAMI_SCRIPT_URL is set without UMAMI_WEBSITE_ID, so the site sends no analytics." };
  if (!isHttpUrl(src)) return { tag: "", warning: "UMAMI_SCRIPT_URL is not an http or https URL, so the site sends no analytics." };
  if (!ID.test(id)) return { tag: "", warning: "UMAMI_WEBSITE_ID holds characters other than letters, digits and hyphens, so the site sends no analytics." };
  if (domains && !HOSTS.test(domains)) return { tag: "", warning: "UMAMI_DOMAINS is not a comma-separated list of host names, so the site sends no analytics." };
  const domainAttr = domains ? ` data-domains="${domains}"` : "";
  return {
    tag: `<script async src="${src}" data-website-id="${id}" data-auto-track="false" data-do-not-track="true" data-exclude-search="true"${domainAttr}></script>`,
  };
}

/**
 * index.html with the tag, read once at startup. A missing page gives null and an error instead of an exception,
 * so a broken dashboard build does not stop the API.
 */
export function loadPage(file: string, tag: string): { page: string | null; error?: string } {
  try {
    return { page: withUmami(readFileSync(file, "utf8"), tag) };
  } catch (e) {
    return { page: null, error: `Cannot read ${file}, so the server serves only the API: ${(e as Error).message}` };
  }
}

/** The page with the tag at the end of its head. */
export function withUmami(html: string, tag: string): string {
  // A function, so that a "$" in the tag is copied as it is and not read as a replacement pattern.
  return tag ? html.replace("</head>", () => `${tag}</head>`) : html;
}
