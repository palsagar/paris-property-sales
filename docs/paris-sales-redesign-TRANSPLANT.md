# Paris & Suburbs Property Sales: UI/UX redesign, transplant guide

The package is not in the repository. It was applied on branch `ui-redesign`.

This package moves the redesign from the Design canvas into the app. It was built and tested against commit
`a8d445d` ("Count visits and control use with Umami (#10)").

Everything it touches is front end, under `artifacts/data-app/`:

- The API, the server, the data and `pnpm-lock.yaml` are unchanged.
- No package is added. The new pieces use what `package.json` already has: `vaul` (the phone sheet), `cmdk` (search),
  the Radix popover, switch and dropdown menu, and `lucide-react`.

Design canvas (private until you share it): https://claude.ai/code/artifact/894eae6f-f8d8-46aa-9381-919c3381c50e

---

## What is in this package

| Path | What it is |
| --- | --- |
| `redesign.patch` | One `git apply` patch for all 29 files (3 new, 24 changed, 2 deleted). This is the recommended route. |
| `overlay/artifacts/data-app/…` | The same changes as whole files, at their repo paths, for when the patch does not apply (for example, if you have edited those files since). |
| `overlay/DELETE-these-files.txt` | The two files the redesign removes. |
| `design/screenshots/` | The implemented UI at 1440, 834 and 375 px, on your real data. Map tiles could not load where these were taken, so the map shows its grey base. |
| `design/canvas/` | The source of the Design canvas: 7 artboards and `canvas.json`. |
| `design/assets/` | The two map illustrations used on the canvas. |
| `verify/` | Results of the checks in section 8. |

---

## 1. Before you start

```bash
cd ~/projects/paris_housing
git status                      # artifacts/data-app should have no local changes
git log -1 --oneline            # a8d445d, or a later commit that leaves these files alone
git switch -c ui-redesign
```

## 2. Apply

**Option A: the patch (recommended)**

```bash
git apply --check /path/to/paris-sales-redesign/redesign.patch   # dry run; prints nothing when all is well
git apply /path/to/paris-sales-redesign/redesign.patch
git status --short   # 3 new (??), 24 modified (M), 2 deleted (D)
```

If `--check` complains about a file, you changed it after `a8d445d`. Either merge that one file from `overlay/` by
hand, or apply everything else with `git apply --reject` and resolve the `.rej` hunks.

**Option B: the overlay**

```bash
cp -R /path/to/paris-sales-redesign/overlay/artifacts/ ./artifacts/
git rm artifacts/data-app/src/components/filter-bar.tsx artifacts/data-app/src/components/refresh-control.tsx
```

## 3. Verify

```bash
pnpm install                                         # nothing should change in the lockfile
pnpm --filter @workspace/data-app run typecheck
pnpm --filter @workspace/data-app run test           # 77 tests: the 74 before, plus 3 new
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/data-app run build

# With the API server running and warmed (BASE_URL defaults to http://localhost:3000):
pnpm --filter @workspace/data-app run latency        # every section; also re-run `steps` on your reference machine
pnpm --filter @workspace/data-app run dev            # then check the list below by hand
```

Check by hand:

- **Widths:** 375, 768, 1024 and 1440 px. There should be no sideways scroll at 375.
- **Selection bar:** it stays pinned while you scroll, at every width. On a laptop, Area and Period open popovers; on a
  phone, one button opens the sheet.
- **Back button:** pick two Areas, then press Back. The first Area should return. Dragging the dates must not add
  history entries.
- **Dark mode:** it follows the system setting. Toggle it, reload, and the choice should be remembered. Toggle back to
  the system's own theme and it follows the system again.
- **Keyboard:**
  - Tab reaches the skip link first, then the masthead, then the Selection bar.
  - Esc closes the popovers.
  - The arrow keys move the brush handles.
  - Tab moves into the heat map's cells, and their figures appear above the grid.
- **Map:**
  - A plain mouse wheel scrolls the page and shows a hint; ⌘ or Ctrl with the wheel zooms the map.
  - On a phone, one finger scrolls the page and two fingers move the map.
  - Arrondissement numbers appear once the map is zoomed in far enough.
- **Print preview:** the controls are hidden and the cards fit their pages.
- **Reduced motion:** nothing animates.

## 4. What changed, file by file

All paths are under `artifacts/data-app/`.

| File | Change |
| --- | --- |
| `index.html` | **Changes:**<ul><li>Pinch zoom is allowed again: `maximum-scale=1` is removed (WCAG 1.4.4).</li><li>The unused Inter font is removed.</li><li>Adds `theme-color` meta tags.</li><li>A small inline script applies dark mode before the first paint, so the page does not flash light.</li></ul> |
| `src/index.css` | **New tokens:** `sunken`, `control` border (3.6:1), `fall` and `rise` chip colours, focus ring (now navy), and real shadow values for floating things only.<br>**Also:**<ul><li>Fraunces 600/700.</li><li>Map label and tooltip styles.</li><li>44 px touch targets.</li><li>Inputs are 16 px on touch screens, so iOS does not zoom on focus.</li><li>`scroll-padding-top` under the sticky bar.</li><li>The progress line under the bar.</li><li>The card "rise" animation is removed.</li></ul> |
| `src/hooks/use-theme.ts` | **New.** Theme follows the system and remembers a choice made with the toggle. |
| `src/components/selection-bar.tsx` | **New.** Replaces `filter-bar.tsx`.<ul><li>On a laptop: Area field, property type, Period field and a status line ("12 054 sales in this Selection", or "Updating").</li><li>On a phone: one summary button that opens a sheet holding all three.</li></ul> |
| `src/components/area-picker.tsx` | Now the body of the Area picker, used both in the laptop popover and in the phone sheet.<ul><li>Empty: tiles for Paris and the 20 arrondissements, plus the 3 Departments.</li><li>Typed: grouped search, as before.</li></ul> |
| `src/components/time-control.tsx` | Now the body of the Period picker, used both in the laptop popover and in the phone sheet.<ul><li>Presets as pills.</li><li>The same brush, with its commit-on-release and refocus logic unchanged.</li><li>Year ticks under the brush.</li><li>**New** From/To month menus, so changing dates does not require dragging (WCAG 2.5.7).</li></ul> |
| `src/components/kpis.tsx` | **Changes:**<ul><li>Median price per m² leads, with its Change and the start and end figures.</li><li>Beside an Area, it also shows "All Paris" for the same type and Period.</li><li>Total volume moves into the Sales card.</li><li>The surface card says "Built surface".</li><li>The house share is noted once, and only from 1%.</li></ul> |
| `src/components/areas-card.tsx` | **New.** One card for the ranking and the heat map, with tabs and one Group menu. This removes the duplicated group switch. |
| `src/components/ranking.tsx` | **Changes:**<ul><li>Body only.</li><li>The value now has its own column, and the bar has no text on it.</li><li>The house-share column shows only when it says something; in Paris it is about 0% everywhere.</li><li>On a phone the list does not scroll inside its box.</li></ul> |
| `src/components/heatmap.tsx` | **Changes:**<ul><li>Body only.</li><li>Fits a 375 px screen without sideways scrolling.</li><li>The readout opens on hover, focus or tap, and has ◀ ▶ buttons to step through quarters.</li><li>"Focus the page on …" selects the Area.</li></ul> |
| `src/components/map-panel.tsx` | **Changes:**<ul><li>The legend moves under the map. On a phone it becomes a list of colour ranges.</li><li>The time-travel row is restyled.</li><li>Shorter descriptions.</li></ul> |
| `src/components/sales-map.tsx` | **Changes:**<ul><li>Scroll and gesture guard, with hints.</li><li>Arrondissement numbers on the map.</li><li>`invalidateSize` when the map is shown again after the phone Map/List tabs.</li></ul> |
| `src/components/hero-trend.tsx` | **Changes:**<ul><li>A one-sentence takeaway above the chart.</li><li>Each line's name is written at its end, so the lines need no legend.</li><li>Uses the shared switch control.</li><li>Ticks at 12 px.</li></ul> |
| `src/components/distributions.tsx` | **Changes:**<ul><li>Takeaway sentences.</li><li>Labels at 12 px.</li><li>The rooms chart is now a table with one bar measure; the second vertical axis is gone.</li></ul> |
| `src/components/transactions.tsx` | **Changes:**<ul><li>On a phone, one card per Sale, with a sort menu.</li><li>The Area column is hidden when the Selection is a single Area.</li><li>`aria-sort` on sortable columns.</li><li>Copy says "sales", not "transactions".</li><li>New `text-page` test id.</li></ul> |
| `src/components/ui-bits.tsx` | **Shared controls:**<ul><li>Three button kinds: `outlineBtnCls`, `iconBtnCls`, `primaryBtnCls`.</li><li>`Segmented`, now able to act as tabs.</li><li>`FieldButton`, `SwitchField` and `CsvButton`.</li><li>One tooltip style (`TipBox`).</li><li>`ChartCard` gains `lede`, `controls` and a heading `level`.</li><li>`StepLegend` shows a list of colour ranges on a phone.</li><li>New colours for `DeltaChip`.</li></ul> |
| `src/components/error-boundary.tsx` | The crash screen uses the theme's colours, so it follows dark mode. |
| `src/pages/dashboard.tsx` | **New order:** masthead, intro, sticky Selection bar, the selected Area with its figures, then "Compare areas" (map and areas card, as tabs on a phone), the trend, "What sold", the Sales list, and "About the data" merged with the sources in the footer.<br>**Also:**<ul><li>Breadcrumb.</li><li>Copy link, or the phone's share sheet.</li><li>Skip link.</li><li>The Refresh control is removed.</li></ul> |
| `src/lib/view-state.ts` | A new Area adds a history entry, so Back works on phones; every other change replaces the entry. Back and Forward restore the view. |
| `src/lib/selection-queries.ts` | Adds the All Paris summary when an Area is selected, so it loads with the rest and the page still changes in one redraw. |
| `src/lib/analytics.ts` | The event changes are listed in section 6. |
| `src/lib/fmt.ts` | `inArea()` turns "11e arrondissement" into "the 11e arrondissement". `keep()` uses no-break spaces so "12 054 EUR" never splits across lines. |
| `*.test.ts` | 3 new tests (history mode, `inArea`, `keep`), plus updates for the new query and the removed `refresh` event. |
| `e2e/latency.mjs` | **Adapted to the pickers:**<ul><li>`reveal()` opens the right picker outside the measured window.</li><li>`findDot` scrolls the map into view.</li><li>The page counter is read from `text-page`.</li><li>The rooms check looks for its table.</li></ul> |
| `filter-bar.tsx`, `refresh-control.tsx` | Deleted. |

---

## 5. Behaviour changes to know about

These are deliberate decisions. Each can be reverted on its own.

1. **The answer comes before the comparison.** The selected Area's key figures now sit above the map. On a phone they
   are the first thing under the Selection bar, not about 1 000 px further down.
2. **Period is behind a button on a laptop.** A year preset now takes two clicks instead of one. In exchange, the
   sticky bar goes from about 120 px to about 72 px. Watch the `change-period` counts after launch.
3. **Tapping a heat map cell shows its figures; it no longer selects the Area.** On a phone, a 13 px cell is a figure
   to read, not a target to aim for. To select the Area, use its row name or the "Focus the page on …" button.
4. **Back and Forward move between Areas.** Only Area changes add history entries; dates and panel settings do not.
5. **The map ignores a plain wheel.** ⌘ or Ctrl with the wheel zooms, and a hint says so. On a phone, one finger
   scrolls the page and two fingers move the map.
6. **Refresh is gone.** The data changes twice a year, so it did not earn its place in the masthead.
7. **Dark mode follows the system and is remembered.**
8. **"Major towns" is not an Area tile.** It is a group in the ranking, not an Area the URL can hold. It stays
   reachable through search and the Group menu.
9. **Arrondissement headings are numeric.** The heading reads "11e arrondissement", matching the bar. The official name
   (Popincourt) moves to the line underneath.

## 6. Analytics (Umami) changes

| Event | Change |
| --- | --- |
| `refresh`, `set-auto-refresh` | **Removed**, with the Refresh control. |
| `copy-link` `{ via: "clipboard" \| "share" }` | **New.** The link itself is never sent. |
| `change-compare-view` `{ view: "map" \| "list" \| "ranking" \| "quarters" }` | **New.** Covers the phone's Map/List tabs and the Ranking/Quarter tabs. |
| `change-period` | `via` gains `"months"`, for the From/To menus. |
| `select-area` | The same values. Tiles still send `via: "buttons"`; breadcrumbs send `"back-link"`. Back and Forward send nothing, because they are not a control. |
| `change-ranking-group` | Fires from the one Group menu, which replaces the two switches. |

Update any Umami goals or reports that used the removed events, and the events list in `docs/architecture.md`.

## 7. What a redesign must keep (brief, section 12), and how it is kept

- **No Valuation.** The figures describe past Sales, and the footer now says so in its first line.
- **Location rule.** Sales show their street only, and the Sales list says so. Dot rounding is unchanged.
- **Figure rules.**
  - Medians from fewer than 5 Sales still show "Too few sales".
  - Points with fewer than 10 Sales are still marked.
  - The 9-step quantile scale is unchanged and still shared by every panel.
- **Dot map.** Same dots, same map library, no clusters.
- **Change model and speed target.**
  - `useShownView` is untouched.
  - The All Paris summary is prefetched with the Selection, so the page still changes in one redraw.
  - The e2e behaviour checks pass (section 8).
- **Selection in the URL.** The same parameters. Area changes now also add a history entry.
- **Vocabulary.** Sale, Area, Selection, Period, Quartier and Commune are used as before.

## 8. What I verified, and the limits

- **Typecheck, tests and build:** all pass. There are 77 tests.
- **The patch:** applies cleanly to a pristine copy of `a8d445d`, and reproduces the tested files byte for byte.
- **Running app:** I ran your API server with your `sales.duckdb`, served the new build, and drove it with Playwright
  at 1440, 834 and 375 px.
  - There were no page errors.
  - There is no sideways scroll at 375 px.
  - Back works after selecting an Area.
- **e2e functional sections** (`behaviour`, `slider`, `analytics`, `warm`): every check passes. See
  `verify/e2e-functional.txt`.
- **e2e `steps` (the 200 ms budget):** this result is not conclusive. Both the old and the new build exceed 200 ms in the
  sandbox, which has no GPU and is about twice as slow as the budget assumes. One run each gave these means:

  | Step | Before | After |
  | --- | --- | --- |
  | Area search | 522 ms | 395 ms |
  | Property type | 402 ms | 382 ms |
  | Year buttons | 439 ms | 417 ms |
  | Arrondissement tiles | 498 ms | 576 ms |
  | Slider release | 380 ms | 446 ms |

  React commits per change fell from 10–18 to 3–6. These differences are within single-run noise, so they show no
  clear regression in either direction. **Re-run `latency steps` on your reference machine before launch.** If the
  arrondissement tiles really are slower there, the likely cause is the picker unmounting when it closes; keeping its
  content mounted with Radix `forceMount` would avoid that.
- **Screenshots:** Google Fonts and Esri tiles are blocked in the sandbox. I served the same fonts locally from
  `@fontsource`, so the type is right, but the map shows only its grey base.

## 9. Gaps against the canvas, and follow-ups

- **Area search results** do not show each Area's median and colour, as the canvas does. Doing that would add a
  Quartier stats request every time the picker opens.
- **Distributions on a phone** are stacked, not tabbed as on the canvas.
- **Self-host the fonts** (brief, rough spot #14): run
  `pnpm add @fontsource-variable/fraunces @fontsource/ibm-plex-sans @fontsource/ibm-plex-mono`, then swap the Google
  `@import` at the top of `index.css` for the three packages. Fraunces' family name becomes "Fraunces Variable", so
  update `--app-font-display` to match.
- **Docs:** update `docs/design-brief.md` (it describes the old layout) and the analytics events list.
- **Tests:** component tests for `SelectionBar` and `AreaPicker` would help. The repo's `node:test` setup covers
  `lib/` only, so this would mean adding a DOM test runner, which is a separate decision.

## 10. Roll back

Before committing:

```bash
git apply -R /path/to/paris-sales-redesign/redesign.patch
```

After committing, revert that commit.

---

### Appendix: design tokens

| Role | Light | Dark |
| --- | --- | --- |
| Background | `#f6f3ee` | `#0e121b` |
| Card | `#fcfbf8` | `#141824` |
| Sunken (new: segmented track, hover) | `#efebe4` | `#1b2030` |
| Text | `#151e32` | `#f1ece4` |
| Muted text | `#5e6678` (5.2:1) | `#9299aa` (6.2:1) |
| Border, for cards and dividers only | `#ded7cf` | `#252a37` |
| Control border (new: inputs and fields, 3.6:1) | `#8b8378` | `#727a8e` |
| Primary (bordeaux) | `#952336` | `#e25a71` |
| Navy: comparison line and focus ring | `#1f3a68` | `#8fb0e6` |
| Fall chip (background / text) | `#e3ebf7` / `#1f3f75` | `#1a2638` / `#b9d0f5` |
| Rise chip (background / text) | `#f8e1e1` / `#8e1b2b` | `#3a1c22` / `#f2a3ad` |

- **Type, laptop / phone:**
  - Headline 40 / 26 px
  - Area heading 36 / 30 px
  - Section 26 / 22 px
  - Card title 19 / 18 px
  - Body 16 px
  - Labels 14 px
  - Captions 12 px, the smallest size anywhere
- **Radii:** 12 px for cards and sheets, 8 px for controls and tooltips, 4 px for chips.
- **Control heights:** 40 px with a mouse, 44 px on touch screens.
- **Elevation:** cards are flat. Only tooltips and popovers (`--shadow-md`, `--shadow-xl`) and the phone sheet
  (`--shadow-lg`) have shadows.
