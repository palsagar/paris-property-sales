# French Version, Author Links and Link Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Visitor read the whole dashboard in English or French, show a small author credit with links at the top right, and give every shared link an attractive preview, while search engines stay blocked.

**Architecture:** The texts live in two hand-written files, `en.ts` and `fr.ts`. The French file has the type of the English one, so the type check finds a missing text. The current language is module state, read by components and by the formatting helpers in `lib/fmt.ts`. A language change redraws the whole page under a new React `key`. The Selection lives in the URL and the data lives in the React Query cache, so nothing is fetched again. The server adds the absolute preview tags to `index.html` at startup, the same way it adds the Umami tag. It sends `X-Robots-Tag: noindex, nofollow` on every response.

**Tech Stack:** React 19.1, TanStack Query 5, Recharts 2.15, Leaflet 1.9, Express 5, `node:test` with tsx, `playwright-core` with the installed Chrome. No new package.

**Spec:** The decisions below, which were agreed in the planning session of 2026-11-08 (the `grill-with-docs` rounds). Read them with `CLAUDE.md`, `CONTEXT.md` (now with a French term for each entry), `docs/architecture.md` and ADR 0006.

## Decisions

- **One PR** for all three features. It also completes "Block search engines" in issue #1.
- **First language:** French when the browser's first language starts with `fr`, otherwise English. A Visitor's choice is saved in `localStorage` under the key `lang`, like the theme. The language is never in the URL.
- **What is translated:** every visible text, `aria-label`, `title` and `placeholder`, the page `<title>`, chart axes and tooltips, map tooltips, toasts, the data note and printed text.
- **What is not translated:** Area names, Department names and street names, which are French proper names. Arrondissement labels keep the form "11e arrondissement" in both languages, as the English site does today. The user confirmed this on 2026-11-08. Numbers and money keep "12 000 EUR" in both languages. Only the words and month names change. The CSV export does not change.
- **French text** uses the `_French_` terms in `CONTEXT.md`. Area is "Secteur", Change is "Évolution", and "estimation" appears only for a Valuation, which the site never gives. The user reviews `fr.ts` before merge.
- **Server labels:** the client builds the year labels ("2026, Jan–Jun") and the quarter labels ("2024 Q1") from the dates that come with them. The API does not change.
- **Author line:** "by Sagar Pal · ★ Star on GitHub". "Sagar Pal" links to `https://sagar-pal.dev`, and the star links to `https://github.com/palsagar/paris-property-sales`. Both open in a new tab. There is no live star count.
- **Header:** the EN|FR switch is visible on a laptop and on a phone, never only in "More". The author line sits at the top right. The switch and the buttons are hidden in print, and the author line stays.
- **Analytics:** two new events, `change-language { to }` and `author-link { target: "github" | "site" }`. Existing events carry the same values in both languages.
- **Link preview:** one static image, `og-image.png`, 1200×630 and under 300 KB. It shows a map of Paris and the three Departments, coloured on the site's price scale with no numbers, the two site names, a one-line description in French and English, and the host name. A script draws it with Chrome. The preview title is "Ventes immobilières à Paris et alentours · Paris & Suburbs Property Sales".
- **Public address:** the `SITE_URL` setting. The Dockerfile sets it to `https://parism2.gpuphysics.dev`, and Coolify can override it.
- **Search engines:** `noindex, nofollow` in the `robots` meta tag and in an `X-Robots-Tag` header on every response. `robots.txt` allows `/` and disallows `/api/`, so preview bots can read the page. ADR 0006 does not change.

## Global Constraints

- Paths in tasks are under `artifacts/data-app/` unless they start at the repository root or with `artifacts/api-server/`.
- pnpm is not installed globally. Every `pnpm` command below means `npx -y pnpm@10.26.1`. The shell is zsh, so write the command out or use a function such as `p() { npx -y pnpm@10.26.1 "$@"; }`. A variable such as `P="npx …"; $P run` fails.
- No package is added, and `pnpm-lock.yaml` must not change.
- Never commit `artifacts/api-server/data/sales.duckdb`, `data-raw/src/` or `docs/paris-sales-redesign.zip`.
- The Vite dev server has no `/api` proxy. Test against the Docker container on http://localhost:3000, or with `DIST=<absolute path>` for a local build. `DIST` must be an absolute path, for example `DIST=$PWD/artifacts/data-app/dist/public`.
- Build: `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/data-app run build`.
- Speed gate: every `latency steps` step at most 200 ms, and no step more than 10% slower than the `main` baseline. Each figure is the mean of 3 runs. Run 1 often has cold spikes.
- An Umami event never carries data about a single Sale.
- Write the English text in the plain style of `docs/design-brief.md`. Use the terms of `CONTEXT.md` in English and their `_French_` terms in French. Do not use "banlieue", "zone" or "transaction" in French text.
- `e2e/latency.mjs` is the only browser test harness. New UI behaviour gets a check in its `behaviour` section, and new events get a check in its `analytics` section.

## Review Focus

1. **Analytics in French.** A Visitor in French picks the 11e arrondissement. The `select-area` event must still say `area: "Paris 11e"`, and `open` must still say `type: "apartment"`, exactly as in English. Otherwise the statistics split by language. Test: Task 2, `areaProps is the same in both languages`, and the analytics check `events-same-in-french`.
2. **Storage that fails.** With site data blocked, the page must load in the browser's language, and the switch must work for the visit. Test: Task 2, check `lang-without-storage`.
3. **Text built outside React.** Map tooltips (`map-panel.tsx`, `dots.ts`, `sales-map.tsx`) are HTML strings. After a switch they must be French, and an apostrophe such as "d'après" must not break the HTML. Test: Task 4, check `french-tooltips`.
4. **Longer French text on a phone.** French is often 15–25% longer. At 375 px wide, no French screen may scroll sideways, and the Selection bar must stay on screen. Test: Task 4, check `french-fits-phone`.
5. **Old links.** A link made before this PR, opened in a French browser, must show the same Selection in French. The switch must never add `lang` to the URL. Test: Task 2, check `lang-keeps-selection`.

---

### Task 1: Translation core and language-aware formatting

**Files:**
- Create: `src/lib/i18n/language.ts`, `src/lib/i18n/en.ts`, `src/lib/i18n/fr.ts`, `src/lib/i18n/messages.ts`, `src/lib/i18n/provider.tsx`
- Modify: `src/lib/fmt.ts`, `src/lib/period.ts`, `src/main.tsx`, `index.html` (the inline script), `e2e/latency.mjs` (`openPage`)
- Test: `src/lib/i18n/language.test.ts`, `src/lib/i18n/messages.test.ts`, `src/lib/fmt.test.ts`

**Interfaces:**
- Produces, in `language.ts` (no React):
  - `type Lang = "en" | "fr"`
  - `pickLang(saved: string | null, browser: readonly string[]): Lang`
  - `readLang(): Lang` reads `localStorage["lang"]` and `navigator.languages`, with a `try`/`catch`.
  - `saveLang(l: Lang): void`
  - `getLang(): Lang`
  - `setLang(l: Lang): void` sets the module state only. Tests use it too.
  - `plural(n: number, one: string, other: string): string` uses `Intl.PluralRules(getLang())`.
- Produces, in `en.ts`: `export const en = { … }` and `export type Messages = typeof en`. The texts are grouped by component (`header`, `intro`, `selection`, `kpis`, `trend`, `distributions`, `heatmap`, `ranking`, `map`, `sales`, `notes`, `errors`, `fmt`, `months`). A text with a number in it is a function, for example `rooms: (n: number) => string`.
- Produces, in `fr.ts`: `export const fr: Messages`.
- Produces, in `messages.ts`: `t(): Messages`, which returns `fr` or `en` for `getLang()`.
- Produces, in `provider.tsx`: `<LanguageProvider>` and `useLanguage(): { lang: Lang; change: (l: Lang) => void }`. `change` calls `setLang` and `saveLang`, sets `document.documentElement.lang` and `document.title`, and renders its children under `<Fragment key={lang}>`.
- Produces, in `fmt.ts`: `tooFew(): string` (replaces `TOO_FEW`), `yearRangeLabel(from: string, to: string): string`, `bucketLabel(period: string, gran: GranularityParameter): string`. `monthLabel`, `longMonthLabel`, `dateLabel`, `inArea`, `houseShareLabel` and `houseShareWarning` keep their signatures and follow `getLang()`.

- [ ] **Step 0: Record the speed baseline of `main`**

The container on http://localhost:3000 runs `main`. Run `pnpm --filter @workspace/data-app run latency steps` three times. Save the mean of each step in the scratchpad. Task 5 compares against these numbers. If Docker cannot connect, ask the user to start Docker Desktop, then wait for `(healthy)` and "Response cache warmed" in `docker compose logs`.

- [ ] **Step 1: Write the failing tests**

`language.test.ts`:
- `pickLang("fr", ["en-GB"])` is `"fr"`. `pickLang("en", ["fr-FR"])` is `"en"`.
- `pickLang(null, ["fr-FR", "en"])` is `"fr"`. `pickLang(null, ["FR"])` is `"fr"`.
- `pickLang(null, ["en-US", "fr"])` is `"en"`. `pickLang(null, [])` is `"en"`. `pickLang("de", ["de-DE"])` is `"en"`.
- After `setLang("fr")`: `plural(0, "vente", "ventes")` is `"vente"` and `plural(2, …)` is `"ventes"`. After `setLang("en")`: `plural(0, "sale", "sales")` is `"sales"`.

`messages.test.ts`:
- **French is complete:** walk both objects. Every key of `en` exists in `fr` with the same kind (string or function).
- **French is not English:** every `fr` string differs from its `en` string, except for an allowlist. The allowlist holds only the words that `CONTEXT.md` keeps the same in both languages (`DVF`, `Mutation`, `Arrondissement`, `Quartier`, `Commune`), `EN`, `FR` and the author's name. For function texts, compare `f(2)` for each.
- **No avoided words:** no `fr` string matches `/\b(banlieue|zone|transaction)s?\b/i`.

`fmt.test.ts`, added cases:
- English, which matches what the server sends today: `yearRangeLabel("2021-07-01", "2021-12-31")` is `"2021, Jul–Dec"`. `yearRangeLabel("2024-01-01", "2024-12-31")` is `"2024"`. `yearRangeLabel("2026-01-01", "2026-01-31")` is `"2026, Jan"`. `bucketLabel("2024-04-01", "quarter")` is `"2024 Q2"`. `bucketLabel("2024-03-01", "month")` is `"2024-03"`. `bucketLabel("2024-01-01", "year")` is `"2024"`.
- French: `yearRangeLabel("2021-07-01", "2021-12-31")` is `"2021, juil.–déc."`. `bucketLabel("2024-04-01", "quarter")` is `"T2 2024"`. `monthLabel("2024-02")` is `"févr. 2024"`. `longMonthLabel("2026-08")` is `"août 2026"`. `dateLabel("2024-03-05")` is `"5 mars 2024"`. `tooFew()` is `"Trop peu de ventes"`.
- Unchanged in both languages: `eur(12054)` is `"12 054 EUR"`, `pct(3.44)` is `"+3.4%"`, `arrLabel(1)` is `"1er"`.

- [ ] **Step 2: Run the tests and check that they fail**

Run: `pnpm --filter @workspace/data-app run test`
Expected: FAIL. The `i18n` modules and the new `fmt` functions do not exist.

- [ ] **Step 3: Write `language.ts`, `messages.ts` and `provider.tsx`, and make `fmt.ts` and `period.ts` follow the language**

`en.ts` starts with the texts that `fmt.ts` needs. Later tasks add the others. The French months are `janv. févr. mars avr. mai juin juil. août sept. oct. nov. déc.` (short) and the full names in lower case (long). `yearBucketLabel` in `period.ts` keeps its signature. `LanguageProvider` wraps `<App />` inside the `ErrorBoundary` in `main.tsx`. `QueryClient` is a module constant in `App.tsx`, so the cache survives the `key` change.

- [ ] **Step 4: Set the language before the first paint**

Extend the inline script in `index.html`. It sets `document.documentElement.lang` with the same rule as `pickLang`, inside the existing `try`. Keep one script, not two, because a CSP hash for the inline script is a deferred item.

- [ ] **Step 5: Pin the test browser's language**

`openPage` in `e2e/latency.mjs` gets a `locale` option, default `"en-GB"`, which is passed to `browser.newContext`. Without it, the existing English checks depend on the language of the Mac.

- [ ] **Step 6: Run the checks**

Run: `pnpm --filter @workspace/data-app run test && pnpm run typecheck`
Expected: PASS. The English page is unchanged.

- [ ] **Step 7: Commit**

```bash
git add artifacts/data-app/src/lib/i18n artifacts/data-app/src/lib/fmt.ts artifacts/data-app/src/lib/fmt.test.ts artifacts/data-app/src/lib/period.ts artifacts/data-app/src/main.tsx artifacts/data-app/index.html artifacts/data-app/e2e/latency.mjs
git commit -m "Add the English and French texts and language-aware formatting"
```

### Task 2: Header: language switch, author links and their events

**Files:**
- Create: `src/components/author-links.tsx`
- Modify: `src/pages/dashboard.tsx` (the `<header>`, lines 249–273 at `79ca4f7`), `src/lib/analytics.ts`, `src/lib/i18n/en.ts`, `src/lib/i18n/fr.ts`
- Test: `src/lib/analytics.test.ts`, `e2e/latency.mjs` (`behaviour` and `analytics`)

**Interfaces:**
- Consumes: `useLanguage()`, `t()`, `setLang` (Task 1).
- Produces: `<AuthorLinks />`, with test ids `link-author-site` and `link-author-github`. The language switch is `Segmented` with `testId="lang"`, so its buttons are `lang-en` and `lang-fr`, with `aria-pressed`. Its group label is the same in both languages, "Language · Langue", so a reader of either language finds it. New `Events` entries: `"change-language": { to: Lang }` and `"author-link": { target: "github" | "site" }`.

- [ ] **Step 1: Write the failing tests**

`analytics.test.ts`: `areaProps is the same in both languages`. For `{ kind: "arr", arr: 11 }`, `{ kind: "paris" }` and `{ kind: "department", id: "93" }`, `areaProps` gives the same result after `setLang("en")` and after `setLang("fr")`. `openProps` gives the same `type`.

`e2e/latency.mjs`, `behaviour`:
- `lang-default`: with `locale: "fr-FR"`, `<html lang>` is `fr` and `lang-fr` has `aria-pressed="true"`. With `"en-GB"`, both are English.
- `lang-switch`: in English, a click on `lang-fr` sets `<html lang="fr">` and changes `document.title` to the French site name. After a reload, the page is still in French.
- `lang-keeps-selection`: open `/?arr=11&type=Appartement` with `locale: "fr-FR"`. Switch to English and back. The URL stays the same and has no `lang` parameter, and `text-area-name` contains `11e`.
- `lang-without-storage`: an init script makes `localStorage` throw. The page loads in the context's language, and the switch still changes the language.
- `author-links`: at 1440 and at 375 px wide, both links are visible inside `<header>`. Their `href` values are exactly `https://sagar-pal.dev` and `https://github.com/palsagar/paris-property-sales`, with `target="_blank"` and `rel` containing `noopener`.
- `print-header`: with `emulateMedia({ media: "print" })`, the switch and the buttons are hidden and the author line is visible.

`analytics`:
- `change-language` is sent once with `{ to: "fr" }` after a click on `lang-fr`. A click on the language that is already selected sends nothing.
- `author-link` is sent with `{ target: "site" }` and `{ target: "github" }`.
- `events-same-in-french`: select the 11e arrondissement in English, then in French. The two `select-area` events have the same properties.

- [ ] **Step 2: Run them and check that they fail**

Run: `pnpm --filter @workspace/data-app run test`, then build and run `DIST=$PWD/artifacts/data-app/dist/public pnpm --filter @workspace/data-app run latency behaviour analytics`
Expected: the new checks FAIL. The existing checks PASS.

- [ ] **Step 3: Build the header**

Laptop: the right side of the header becomes two rows aligned right. The first row is the author line in 12–13 px muted text. The second row holds the switch, "Copy link", "Print" and the theme button. Phone: the switch sits next to "More", and the author line sits below them, in a shorter form ("by Sagar Pal · ★ Star"). Only the switch and the buttons get `print:hidden`. French author line: "par Sagar Pal · ★ Étoile sur GitHub".

- [ ] **Step 4: Send the events**

`change-language` fires only when the language changes. `author-link` fires on the click, before the new tab opens.

- [ ] **Step 5: Run the checks**

Run: `pnpm --filter @workspace/data-app run test && pnpm run typecheck`, rebuild, then `DIST=… latency behaviour analytics`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/data-app/src artifacts/data-app/e2e/latency.mjs
git commit -m "Add the language switch and the author links to the header"
```

### Task 3: French for the page frame, the Selection bar and the key figures

**Files:**
- Modify: `src/pages/dashboard.tsx`, `src/pages/not-found.tsx`, `src/components/selection-bar.tsx`, `src/components/area-picker.tsx`, `src/components/time-control.tsx`, `src/components/kpis.tsx`, `src/components/error-boundary.tsx`, `src/lib/i18n/en.ts`, `src/lib/i18n/fr.ts`
- Test: `e2e/latency.mjs` (`behaviour`)

**Interfaces:**
- Consumes: `t()`, `plural()`, `yearRangeLabel()` (Task 1).
- Produces: `frenchSweep(page, scope: string): Promise<string[]>` in `e2e/latency.mjs`. It returns every English match inside the element `[data-testid=scope]`, or inside `body` when `scope` is `"body"`. It reads visible `innerText` and every `aria-label`, `title` and `placeholder`. English is `/\b(the|and|of|sales?|homes?|houses?|apartments?|price|median|period|area|too few|download|share|print|copy|link|light mode|dark mode|rooms?|quarter|data to|release|all paris)\b/i`.

- [ ] **Step 1: Write the failing check**

`french-frame`: with `locale: "fr-FR"`, run `frenchSweep` on `header`, `intro`, the Selection bar, `focus-header` and the key figures. Do this for the default view, for `/?q=<a Quartier id>`, and for `/?commune=93048` (Montreuil). Also open the Area picker and the Period picker. On a 375 px page, also open the Selection sheet. Every result must be empty.

- [ ] **Step 2: Run it and check that it fails**

Expected: FAIL, with the English strings listed.

- [ ] **Step 3: Move the texts into `en.ts` and `fr.ts`**

Build sentences as whole texts with their numbers, for example `focusLine: (type: string, range: string, n: string) => string`. French word order is different, so never join translated pieces. In `dashboard.tsx`, map the summary's `years` once through `yearRangeLabel(y.from, y.to)`, so `selection-bar.tsx`, `time-control.tsx` and `period.ts` receive the client labels. The toast texts and `lastRefreshed` move too. `toLocaleTimeString` uses `"fr-FR"` or `"en-GB"`, which give the same "14:05".

- [ ] **Step 4: Run the checks**

Run: test, typecheck, build, then `DIST=… latency behaviour`
Expected: PASS, including every existing English check.

- [ ] **Step 5: Commit**

```bash
git commit -am "Translate the page frame, the Selection bar and the key figures"
```

### Task 4: French for the charts, the map, the ranking and the sales list

**Files:**
- Modify: `src/components/hero-trend.tsx`, `distributions.tsx`, `heatmap.tsx`, `ranking.tsx`, `areas-card.tsx`, `map-panel.tsx`, `sales-map.tsx`, `transactions.tsx`, `ui-bits.tsx`, `src/lib/dots.ts`, `src/lib/i18n/en.ts`, `src/lib/i18n/fr.ts`
- Test: `e2e/latency.mjs` (`behaviour`)

**Interfaces:**
- Consumes: `t()`, `plural()`, `bucketLabel()`, `frenchSweep()` (Tasks 1 and 3).

- [ ] **Step 1: Write the failing checks**

- `french-panels`: with `locale: "fr-FR"`, `frenchSweep(page, "body")` is empty for the default view, for the 11e arrondissement with the dot map on, and with each tab or segment of the heat map, the ranking and the distributions selected.
- `french-tooltips`: in French, hover an Area on the map and a dot on the dot map. Each tooltip is not empty, has no English match, and has no visible `&#39;`, `&amp;` or `<` character.
- `french-fits-phone`: at 375 px in French, on the default view and on `/?commune=93048`, `document.scrollingElement.scrollWidth` is at most 375, and the Selection bar's right edge is inside the window.
- `labels-from-dates`: in English, the trend's x-axis labels and the year list are the same as before this PR, for example "2024 Q1" and the Partial year "…, Jul–Dec". In French they read "T1 2024" and "…, juil.–déc.".

- [ ] **Step 2: Run them and check that they fail**

Expected: FAIL.

- [ ] **Step 3: Move the texts**

Replace each use of a server `label` (`hero-trend.tsx:66`, `heatmap.tsx:25,29`, `map-panel.tsx:55`) with `bucketLabel(period, gran)`. Room labels use `plural`. `Appartement` and `Maison` from the API are shown through `t()` in both languages. HTML tooltip strings go through `lib/escape.ts`, as they do now. Recharts axis and tooltip formatters read `t()`.

- [ ] **Step 4: Run all the checks**

Run: test, typecheck, build, then `DIST=… latency behaviour analytics warm`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git commit -am "Translate the charts, the map, the ranking and the sales list"
```

### Task 5: Link preview and search engine blocking

**Files:**
- Create: `artifacts/api-server/src/lib/pageMeta.ts`, `artifacts/api-server/src/lib/pageMeta.test.ts`, `scripts/og-image.ts` (under `artifacts/data-app/`), `public/og-image.png`
- Modify: `index.html`, `public/robots.txt`, `package.json` (script `og-image`), `artifacts/api-server/src/app.ts`, `Dockerfile` (repository root)

**Interfaces:**
- Produces, in `pageMeta.ts`:
  - `siteUrl(env: Record<string, string | undefined>): { url: string; warning?: string }`. It reads `SITE_URL`, accepts only an `https:` origin without a path, quotes or spaces, and removes a trailing `/`. Without a valid value, `url` is `""` and the warning says that link previews have no image.
  - `previewTags(url: string): string` returns `""` for `""`. Otherwise it returns `og:url`, `og:image` (`${url}/og-image.png`), `og:image:width` 1200, `og:image:height` 630, `og:image:alt` and `twitter:image`.
- `app.ts` passes `umami.tag + previewTags(site.url)` to the existing `loadPage`, and logs `site.warning`. `umami.ts` does not change.

- [ ] **Step 1: Write the failing server tests**

`pageMeta.test.ts`:
- `siteUrl({ SITE_URL: "https://parism2.gpuphysics.dev/" }).url` is `"https://parism2.gpuphysics.dev"`.
- `"http://parism2.gpuphysics.dev"`, `"https://x.dev/path"`, `'https://x.dev"><script>'` and a missing value each give `url: ""` and a warning.
- `previewTags("https://parism2.gpuphysics.dev")` contains `<meta property="og:image" content="https://parism2.gpuphysics.dev/og-image.png">` and `content="1200"`. `previewTags("")` is `""`.

- [ ] **Step 2: Run them and check that they fail**

Run: `pnpm --filter @workspace/api-server exec node --import tsx --test --test-name-pattern="siteUrl|previewTags" "src/**/*.test.ts"`
Expected: FAIL.

- [ ] **Step 3: Write `pageMeta.ts`, send `X-Robots-Tag`, and set `SITE_URL`**

The first middleware in `app.ts` sets `X-Robots-Tag: noindex, nofollow` on every response, `/api` included. In the `Dockerfile` runtime stage, add `SITE_URL=https://parism2.gpuphysics.dev` to the existing `ENV`.

- [ ] **Step 4: Change the static tags and `robots.txt`**

`index.html`: `robots` becomes `noindex, nofollow`. `og:title` and `twitter:title` become "Ventes immobilières à Paris et alentours · Paris & Suburbs Property Sales". `description`, `og:description` and `twitter:description` become "Prix au m² des ventes de logements et leur évolution, par quartier et commune, d'après DVF. · Price per m² of home sales and how it changed, by quartier and commune, from DVF." Add `og:site_name` (the French name), `og:locale` `fr_FR` and `og:locale:alternate` `en_GB`. `<title>` stays English, because the provider sets it at load.

`public/robots.txt`:
```
User-agent: *
Allow: /
Disallow: /api/
```

- [ ] **Step 5: Write the image script and draw the image**

`scripts/og-image.ts`, run with `pnpm --filter @workspace/data-app run og-image` (`node --import tsx scripts/og-image.ts`), with `BASE_URL` (default `http://localhost:3000`) and `SITE_URL` (default `https://parism2.gpuphysics.dev`, shown as its host name only):
- Fetch the all-dates, all-types medians from `/api/sales/by-arrondissement` and `/api/sales/by-commune`, with the params that `selectionQueries()` uses for the default view.
- Read `artifacts/api-server/boundaries/arrondissements.geojson` and `communes.geojson`. Keep the Communes whose code starts with `92`, `93` or `94`.
- Project longitude × cos(48.85°) and −latitude, and fit the result to the right part of the canvas. Colour each Area with `quantileThresholds` and `makeStepScale` from `src/lib/colour-scale.ts`, in the light palette. An Area with too few Sales uses the site's "no data" colour.
- Lay out an HTML page, 1200×630, background `#f6f3ee`, text `#151e32`, a bordeaux `#952336` accent. The two site names are in Fraunces 700 and the description line in IBM Plex Sans, both loaded from Google Fonts for this render only. The host name is small at the bottom.
- Take a PNG screenshot with `chromium.launch({ channel: "chrome" })` at device scale 1, into `public/og-image.png`. Stop with exit code 1 when the file is 300 KB or larger.

Run it against the container. Look at the PNG with the Read tool. The text must be readable at the size of a WhatsApp card, about 400 px wide.

- [ ] **Step 6: Run the checks**

Run: the server tests, typecheck, `docker compose up --build -d`, then:
- `curl -sI http://localhost:3000/ | grep -i x-robots-tag` gives `noindex, nofollow`. `curl -sI http://localhost:3000/api/sales/summary?propertyType=all` gives the same header.
- `curl -s http://localhost:3000/ | grep og:image` gives the absolute `https://parism2.gpuphysics.dev/og-image.png`.
- `curl -s http://localhost:3000/robots.txt` gives the three lines above. `curl -sI http://localhost:3000/og-image.png` gives `200` and `image/png`.

Expected: all as stated.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/lib/pageMeta.ts artifacts/api-server/src/lib/pageMeta.test.ts artifacts/api-server/src/app.ts artifacts/data-app/index.html artifacts/data-app/public artifacts/data-app/scripts/og-image.ts artifacts/data-app/package.json Dockerfile
git commit -m "Add the link preview and block search engines with noindex"
```

### Task 6: Documentation

**Files:**
- Modify: `docs/architecture.md`, `docs/design-brief.md`, `README.md`, `CLAUDE.md`, `CONTEXT.md` (already changed in the planning session; commit it here)

- [ ] **Step 1: Update the docs**

- `docs/architecture.md`:
  - "Analytics": add `change-language` and `author-link` to the table.
  - "Dashboard": the texts live in `src/lib/i18n/en.ts` and `fr.ts`, and a new text goes into both. Also describe the first-language rule.
  - "Deployment": the image sets `SITE_URL`, and Coolify can override it.
  - "Update the data": after a DVF release, run `og-image` again if the colours should follow the new release.
  - "Before public launch": remove the search engine items, which are now done.
  - "Improvements": remove the line "French by default, with an English option."
- `docs/design-brief.md:33` and `:244`: the interface is in English and French. Add the header layout with the author line.
- `README.md`, the table of settings: add `SITE_URL`.
- `CLAUDE.md`, "Architecture": one sentence. Every visible text lives in `src/lib/i18n/`, and the French terms are in `CONTEXT.md`.

- [ ] **Step 2: Ask the user before you change issue #1**

The issue says "Block indexing in `robots.txt`". Propose the new text: "Block indexing with `noindex` in the meta tag and in an `X-Robots-Tag` header. `robots.txt` allows the page and blocks `/api/`." Change the issue only after the user agrees, because the issue is public.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture.md docs/design-brief.md README.md CLAUDE.md CONTEXT.md
git commit -m "Document the French version, the author links and the link preview"
```

### Task 7: Verify, review and ship

- [ ] **Step 1: Run every automated check**

Run: `pnpm run typecheck`, `pnpm run test`, the build, `docker compose up --build -d`, then `pnpm --filter @workspace/data-app run latency` with all sections.
Expected: PASS. Then run `latency steps` 3 times. Each step's mean is at most 200 ms and not more than 10% over the Step 0 baseline.

- [ ] **Step 2: Check the page by hand in both languages**

On a laptop and at 375 px wide, in English and in French: the header, a print preview, dark mode, the map tooltips, the sales list, and a long Commune name such as Saint-Germain-en-Laye. Compare the English page with `main` to confirm that nothing changed.

- [ ] **Step 3: Open the PR**

Write the PR body: the decisions, the new events, the latency table before and after, and the checks. The PR body asks the user to review `fr.ts`.

- [ ] **Step 4: Run the two-cycle review**

Use the `two-cycle-review-and-ship` skill: the Claude adversarial review, fixes, then Codex through `~/.claude/skills/two-cycle-review-and-ship/scripts/run-codex-adversarial-review.sh origin/main`, and fixes.

- [ ] **Step 5: Wait for the user's French review, then ask before merging**

Merge only after the user approves `fr.ts` and says to merge. Use a squash merge. After the merge, rebuild the container from `main`.

- [ ] **Step 6: After the deploy (the user's step)**

When `parism2.gpuphysics.dev` is live, check the preview with a preview checking tool, for example the Meta Sharing Debugger, before anyone shares the link on WhatsApp. WhatsApp keeps a preview it has already shown.
