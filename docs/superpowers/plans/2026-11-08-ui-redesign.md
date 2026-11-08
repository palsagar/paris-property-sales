# UI/UX Redesign Transplant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the tested redesign from the Design canvas into `artifacts/data-app`, prove it keeps the 200 ms budget and every behaviour check, update the docs, and ship it as one squash-merged PR.

**Architecture:** The redesign is already written and tested as one patch against `a8d445d`, which is the current `main`. This plan does not rewrite it. It measures `main` first, applies the patch, runs the automated checks and the hand checks, fixes only what fails, and documents the result. All changes are front end. The API, the server, the data and `pnpm-lock.yaml` stay unchanged.

**Tech Stack:** React 19.1, TanStack Query 5, Recharts 2.15, Leaflet 1.9, Radix (popover, switch, dropdown menu), `vaul`, `cmdk`, `lucide-react`, Vite, `node:test` with tsx, `playwright-core` with the installed Chrome.

**Spec:** `docs/paris-sales-redesign-TRANSPLANT.md` (the "guide" below). The package it describes is `docs/paris-sales-redesign.zip`. Read the guide with `CLAUDE.md`, `CONTEXT.md` and `docs/architecture.md`.

## Decisions the user made for this plan

- **Fonts are out of scope.** Self-hosting the fonts (guide §9, issue #1) gets its own PR later. This branch keeps the Google Fonts `@import`.
- **Docs to commit:** `docs/design-brief.md`, rewritten to describe the new layout, and the guide. The zip stays out of git, because its screenshots show real Sales and the repository is public.
- **Speed is a hard gate.** Any `latency steps` figure over 200 ms on this Mac, or clearly slower than `main`, is fixed in this branch before the PR. The first fix to try is Radix `forceMount` on the picker content (guide §8).
- **Shipping:** a PR, a two-cycle review with fixes, then a squash merge into `main`, as for PRs #9 and #10.

## Global Constraints

- Paths in tasks are under `artifacts/data-app/` unless they start at the repository root.
- pnpm is not installed globally. Every `pnpm` command below means `npx -y pnpm@10.26.1`.
- No package is added, and `pnpm-lock.yaml` must not change.
- Never commit `artifacts/api-server/data/sales.duckdb`, `data-raw/src/` or `docs/paris-sales-redesign.zip`.
- The Vite dev server has no `/api` proxy. Do the hand checks against the Docker container on http://localhost:3000, not `vite dev`. The guide's `run dev` step does not work in this repository.
- The build needs `PORT` and `BASE_PATH`: `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/data-app run build`.
- `warmUrls()` in `artifacts/api-server/src/lib/warmUrls.ts` needs no change. The new All Paris summary of a default view is `/sales/summary?propertyType=all`, which the warm-up already fetches. The `warm` section of the latency test proves it.
- Use the terms in `CONTEXT.md` (Sale, Area, Selection, Period, Quartier, Commune, Visitor). An Umami event never carries data about a single Sale.
- Speed budget: each Selection change costs at most 200 ms of main-thread work at a 2× CPU slowdown (`latency steps`).

## Review Focus

These conditions are not covered by any automated test. Task 4 checks each one by hand.

1. **Old links and bookmarks.** A URL with settings, made before the redesign, must open the same Selection, and it must send one `open` event. The parameters are unchanged, but the page around them is new.
2. **Back after date changes.** Pick Area A, drag the dates, pick Area B, then press Back. The page must return to A with the dragged dates, after one press. Dragging must not add a history entry.
3. **The phone sheet and Back.** On a phone, with the Selection sheet open, Back must leave the page in a usable state. The sheet must not stay half open over the page.
4. **Small Areas.** In a Quartier or Commune with few Sales in a short Period: the key figures show "Too few sales", the All Paris column still shows figures, and the heat map readout handles empty quarters.
5. **Dark mode in print, and storage that fails.** Print preview in dark mode must be readable. With site data blocked, the page must load and the toggle must work for the visit.

---

### Task 1: Branch and measure `main`

**Files:** none changed. The results go to the scratchpad and, in Task 6, into the PR body.

- [ ] **Step 1: Check the start state and make the branch**

```bash
cd ~/projects/paris_housing
git status --short            # only the untracked docs/ files; nothing under artifacts/
git log -1 --oneline          # a8d445d
git switch -c ui-redesign
```

- [ ] **Step 2: Keep the zip out of git on this machine only**

```bash
echo "docs/paris-sales-redesign.zip" >> .git/info/exclude
```

- [ ] **Step 3: Unpack the package outside the repository**

```bash
PKG=~/projects/paris-sales-redesign-pkg
mkdir -p $PKG && unzip -o -q docs/paris-sales-redesign.zip -d $PKG
export PATCH=$PKG/paris-sales-redesign/redesign.patch
diff -q $PKG/paris-sales-redesign/TRANSPLANT.md docs/paris-sales-redesign-TRANSPLANT.md   # prints nothing
```

- [ ] **Step 4: Rebuild the server from `main`**

The running container predates `a8d445d`.

```bash
docker compose up --build -d
```

Expected: the container reports `healthy`. Wait until `docker compose logs` shows "Response cache warmed".

- [ ] **Step 5: Build `main`'s dashboard to a separate folder and measure it**

```bash
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/data-app run build
rm -rf ~/projects/dist-main && cp -R artifacts/data-app/dist/public ~/projects/dist-main
for i in 1 2 3; do DIST=~/projects/dist-main pnpm --filter @workspace/data-app run latency steps; done | tee ~/projects/latency-main.txt
```

Expected: each run prints a work figure per step. Record the mean per step over the 3 runs. These are the "before" figures. Use the latency script from `main` here, because the new script expects the new pickers.

### Task 2: Apply the patch and pass the automated checks

**Files:** the 29 files of `redesign.patch` (3 new, 24 changed, 2 deleted). See guide §4.

**Interfaces:**
- Produces: the redesigned dashboard; the `text-page` test id; `parisSummaryParams(v: Selection)` in `src/lib/selection-queries.ts`; `useTheme(): { isDark, choice, toggle }` in `src/hooks/use-theme.ts`; the new Umami events of guide §6.

- [ ] **Step 1: Dry-run, then apply**

```bash
git apply --check $PATCH     # prints nothing
git apply $PATCH
git status --short artifacts/   # 3 "??", 24 " M", 2 " D" (filter-bar.tsx, refresh-control.tsx)
```

If `--check` fails, stop. `main` has moved since `a8d445d`. Report the failing file instead of merging by hand.

- [ ] **Step 2: Install, and confirm that the lockfile does not change**

```bash
pnpm install && git diff --quiet pnpm-lock.yaml && echo LOCK_UNCHANGED
```

Expected: `LOCK_UNCHANGED`.

- [ ] **Step 3: Typecheck the workspace**

Run: `pnpm run typecheck`
Expected: exit 0.

- [ ] **Step 4: Run the dashboard tests**

Run: `pnpm --filter @workspace/data-app run test`
Expected: 77 pass, 0 fail. The 3 new tests are the history mode, `inArea` and `keep`.

- [ ] **Step 5: Run the server tests**

Run: `pnpm --filter @workspace/api-server run test`
Expected: all pass. The patch does not touch the server. A failure here was already on `main`; note it, and do not fix it in this branch.

- [ ] **Step 6: Build**

Run: `PORT=3000 BASE_PATH=/ pnpm --filter @workspace/data-app run build`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add -A artifacts/data-app
git commit -m "Redesign the dashboard: Selection bar, pickers, key figures first, dark mode that follows the system"
```

### Task 3: Run the latency test and apply the speed gate

**Files:** none, unless the gate fails. In that case, see Step 4.

- [ ] **Step 1: Run every functional section against the new build**

```bash
DIST=artifacts/data-app/dist/public pnpm --filter @workspace/data-app run latency behaviour slider analytics warm
```

Expected: every line says `pass`. The output should match `$PKG/paris-sales-redesign/verify/e2e-functional.txt`.

- [ ] **Step 2: Measure the new build 3 times**

```bash
for i in 1 2 3; do DIST=artifacts/data-app/dist/public pnpm --filter @workspace/data-app run latency steps; done | tee ~/projects/latency-redesign.txt
```

- [ ] **Step 3: Compare with `main`**

Make a table with one row per step: the mean on `main`, the mean on the branch, and the change. The gate passes when every branch mean is at most 200 ms and no step is more than 10% slower than on `main`. If it passes, go to Task 4.

- [ ] **Step 4 (only if the gate fails): Find the cause, then fix it**

Use superpowers:systematic-debugging. Start with the arrondissement tiles: the guide suspects that the Area popover unmounts its content when it closes. The first fix to try is `forceMount` on the Radix `PopoverContent` of the Area and Period pickers in `src/components/selection-bar.tsx`, hidden while closed, so that a tile click does not remount the picker. Measure again after each change. Keep a change only if it moves the figure. Re-run Step 1, so the behaviour checks still pass.

- [ ] **Step 5 (only if Step 4 changed code): Commit**

```bash
git add artifacts/data-app
git commit -m "Keep each Selection change within 200 ms after the redesign"
```

### Task 4: Check the page by hand

**Files:** none, unless a check fails. Then fix the cause in the file that owns it, and add a `node:test` case when the fix is in `src/lib/`.

Serve the branch from the container: `docker compose up --build -d`, then open http://localhost:3000. Drive it with Playwright (the `dev-browser` skill or the Playwright MCP tools). Take a screenshot of each width into the scratchpad.

- [ ] **Step 1: Run the guide's checks (§3)**

Run each one, and record pass or fail:
- **Widths:** 375, 768, 1024 and 1440 px, with no sideways scroll at 375 (`document.documentElement.scrollWidth <= innerWidth`).
- **Selection bar:** it stays pinned at every width. Area and Period open popovers on a laptop; one button opens the sheet on a phone.
- **Back:** pick two Areas, press Back, and the first Area returns.
- **Dark mode:** it follows the system (emulate `prefers-color-scheme`). A toggle survives a reload. A toggle back to the system's theme makes the page follow the system again.
- **Keyboard:** the first Tab reaches the skip link, then the masthead, then the Selection bar. Esc closes the popovers. The arrow keys move the brush handles. Tab moves into the heat map cells and shows their figures.
- **Map:** a plain wheel scrolls the page and shows a hint; Ctrl with the wheel zooms. On a 375 px touch emulation, one finger scrolls the page. Arrondissement numbers appear after zooming in.
- **Print preview** (emulate `print` media): the controls are hidden.
- **Reduced motion** (emulate `prefers-reduced-motion: reduce`): nothing animates.

- [ ] **Step 2: Run the Review Focus checks**

1. Open a link with settings in the URL format of `main` (`src/lib/view-state.ts`: `arr`, `q`, `commune`, `dept`, `type`, `from`, `to`, `map`, `level`, `gran`, `rank`). For example: `/?arr=11&type=Appartement&map=dots`, plus `from` and `to` copied from a Period set on `main`. The Selection matches the URL. In the analytics stub, or in the network panel with Umami set, exactly one `open` event is sent.
2. Pick Area A, drag the dates, pick Area B, then press Back once. Expected: A, with the dragged dates.
3. At 375 px, open the Selection sheet, then press Back. Expected: the sheet closes or the page shows the previous Area, and no half-open sheet remains.
4. Pick a small Quartier and a one-year Period. Expected: "Too few sales" where the count is under 5, the All Paris figures beside it, and a heat map readout that steps across empty quarters without errors.
5. Turn on dark mode, then open print preview: the text is readable. Block site data for localhost (or override `localStorage` to throw in a script), then reload: the page loads, and the toggle works for the visit.

- [ ] **Step 3: Check the console**

Expected: no page errors and no React warnings at any width.

- [ ] **Step 4 (only if a check failed): Fix, re-run Task 2 Steps 3–6 and Task 3 Step 1, then commit**

```bash
git add artifacts/data-app
git commit -m "Fix <the failed check> in the redesign"
```

### Task 5: Update the docs

**Files:**
- Modify: `docs/architecture.md` (the Analytics table and the "never sent" list)
- Create (commit for the first time): `docs/design-brief.md`, `docs/paris-sales-redesign-TRANSPLANT.md`, and this plan

- [ ] **Step 1: Update the Analytics section of `docs/architecture.md` from guide §6**

- Remove `refresh` and `set-auto-refresh`. The `print` row stays alone, and so does `toggle-dark-mode`.
- Add `copy-link`: `via` is `clipboard` or `share`. The link itself is never sent.
- Add `change-compare-view`: `view` is `map`, `list`, `ranking` or `quarters`.
- `change-period`: `via` gains `months`, for the From/To menus.
- `select-area`: Back and Forward send nothing.
- In "These are never sent", remove "automatic refreshes".

Check: `grep -n "refresh" docs/architecture.md` prints nothing about the dashboard.

- [ ] **Step 2: Check that `lib/analytics.ts` and the doc agree**

Run: `grep -o '"[a-z-]*"' artifacts/data-app/src/lib/analytics.ts | sort -u`
Expected: every event name in the output is in the doc's table, and every event in the table is in the output.

- [ ] **Step 3: Rewrite the layout parts of `docs/design-brief.md`**

The brief describes the old page. Rewrite its layout sections to describe the new page in guide §4 and §5: the order of the sections, the Selection bar and its sheet, the pickers, the areas card, dark mode, and the history rule. Replace the old file map (`filter-bar.tsx` and the others) with the new one. Remove the rough spots that the redesign fixed, such as the two different toggle switches and the Refresh menu. Keep the self-hosted fonts and the rough spots that are still open. Copy the token table from the guide's appendix.

Check: `grep -n -i "refresh\|filter-bar" docs/design-brief.md` prints nothing.

- [ ] **Step 4: Fix the package paths in the guide**

The guide speaks of `/path/to/paris-sales-redesign/`. Add one line under its title: "The package is not in the repository. It was applied on branch `ui-redesign`." Change nothing else.

- [ ] **Step 5: Commit**

```bash
git add docs/architecture.md docs/design-brief.md docs/paris-sales-redesign-TRANSPLANT.md docs/superpowers/plans/2026-11-08-ui-redesign.md
git status --short   # the zip is not listed
git commit -m "Document the redesigned dashboard and its analytics events"
```

### Task 6: Open the PR, review it, and merge it

- [ ] **Step 1: Run every check one last time**

```bash
pnpm run typecheck && pnpm run test && PORT=3000 BASE_PATH=/ pnpm --filter @workspace/data-app run build
```

Expected: all pass, apart from any server test that already failed on `main` (Task 2 Step 5).

- [ ] **Step 2: Push the branch and open the PR**

The PR body holds:
- a summary of guide §4 and the behaviour changes of guide §5
- the analytics changes, with a note to update any Umami goals that use `refresh` or `set-auto-refresh`
- the before and after latency table from Task 3
- the hand check results from Task 4
- the follow-ups from guide §9: medians in the Area search, tabbed distributions on a phone, the self-hosted fonts (issue #1), and component tests

```bash
git push -u origin ui-redesign
gh pr create --title "Redesign the dashboard" --body-file <body file in the scratchpad>
```

- [ ] **Step 3: Review it in two cycles, and fix what they find**

Use the `two-cycle-review-and-ship` skill. After each fix commit, re-run Task 6 Step 1 and Task 3 Step 1. If a fix touches a picker, `selection-bar.tsx`, `dashboard.tsx` or `selection-queries.ts`, also re-run Task 3 Step 2.

- [ ] **Step 4: Squash merge**

```bash
gh pr merge --squash --delete-branch
git switch main && git pull
docker compose up --build -d   # the local container serves the merged main
```

- [ ] **Step 5: Clean up**

```bash
rm -rf ~/projects/dist-main ~/projects/latency-main.txt ~/projects/latency-redesign.txt
```

Keep `~/projects/paris-sales-redesign-pkg` until the fonts PR is done. It holds the screenshots and the canvas.
