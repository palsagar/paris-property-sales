# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Data rule

Never commit `artifacts/api-server/data/sales.duckdb` or `data-raw/src/`. The raw files link prices to street addresses and exact coordinates, and the built file holds street names and positions rounded to about 100 m. The repository is public. The DVF reuse conditions are the reason. See "Data and licences" in `README.md`. A fresh clone has neither file, so run the two data scripts below first.

## Documentation

- `CONTEXT.md` defines the project's terms. Use them in code, text and conversation.
- `docs/architecture.md` has the full architecture, the Coolify deployment, and the "Before public launch" and "Improvements" lists.
- `docs/adr/` records the major decisions. Read the relevant record before you propose to change one of them. For example, the site never gives a Valuation, and search engines stay blocked.

The goal is a public site for home buyers and Paris residents. It is not ready to launch yet.

## Commands

The repository has no linter. The automated checks are `pnpm run typecheck`, the server tests (the response cache, the DuckDB connection and the SQL queries) and the Python tests for the data scripts. To verify a change, build the app and use it in a browser.

pnpm is not installed globally on this machine. Use `npx -y pnpm@10.26.1` in place of `pnpm`, or install pnpm first.

```sh
# Data: required once per clone, and again after each DVF release. The download is about 610 MB and takes about a minute and a half.
# This runs fetch_dvf.py and then build_paris_sales.py, and the build checks the release before it replaces sales.duckdb.
uv run scripts/update_data.py           # writes data-raw/src/paris.csv and artifacts/api-server/data/sales.duckdb

# Run everything in one container on http://localhost:3000. Compose mounts the data folder.
docker compose up --build -d

# Load new data: the image holds no sales data, so a restart is enough
docker compose restart

# Check types across the workspace
pnpm run typecheck

# Run all tests: the server tests (Node's test runner through tsx) and the Python tests, which need uv
pnpm run test

# Run the Python tests for the data scripts
cd scripts && uv run test_data_scripts.py

# Run one test by name
pnpm --filter @workspace/api-server exec node --import tsx --test --test-name-pattern="byte limit" "src/**/*.test.ts"

# Regenerate the client hooks and validators after editing lib/api-spec/openapi.yaml
pnpm --filter @workspace/api-spec run codegen

# Build the dashboard. The Vite config throws an error if PORT or BASE_PATH is missing.
BASE_PATH=/ PORT=3000 pnpm --filter @workspace/data-app run build

# Build and start the API on its own
PORT=3001 pnpm --filter @workspace/api-server run dev
```

The Vite dev server has no proxy for `/api`, so the dashboard shows no data under `vite dev` until a proxy is added. This also rules out hot reload against the real API for now.

## Architecture

This is a pnpm monorepo with two apps in `artifacts/` and shared packages in `lib/`. In production, one Express process serves both the API and the built dashboard (through `STATIC_DIR`).

**The API contract is the source of truth.** `lib/api-spec/openapi.yaml` generates two packages through Orval: `lib/api-zod` (Zod validators, used by the server) and `lib/api-client-react` (React Query hooks, used by the dashboard). To change an endpoint, edit the YAML first and run codegen. Never edit a `generated/` folder by hand. Routes call `.parse()` on their responses as well as their queries, and Zod removes unknown keys, so a field that is missing from the YAML silently disappears from the response.

**The server reads all Sales from one DuckDB file.** `salesDb.ts` opens `sales.duckdb` read-only and uses one connection for each query. `salesQueries.ts` holds all the SQL, and the routes in `routes/sales.ts` call it. `timeStats.ts` builds the time buckets and the SQL for the Change. `salesData.ts` opens the file at import time with a top-level await. The bundle finds the file at `../data` and the boundary files at `../boundaries`, both relative to `dist/`, so `dist/`, `data/` and `boundaries/` must stay next to each other at runtime. The `boundaries` folder is in git and in the image. In Docker, `data` is a mount at `/app/data`. The image has no such folder, and the mount must hold `sales.duckdb`. The `@duckdb/node-api` package is a native module that the bundle does not include, so the `Dockerfile` installs it into the image.

**Two pieces of code depend on the exact requests the dashboard makes.**
- `lib/responseCache.ts` caches successful `/api` GETs in memory, up to a limit in total bytes. The key is the path plus the query after validation, with the same Zod schema the route uses, so the cache and the route always agree on what a request means. A new route is not cached until you add it and its schema to `QUERY_SCHEMAS`. The cache assumes that the data never changes while the process runs, so a server must restart to show new data.
- `lib/prewarm.ts` fills that cache at startup by calling the server's own API with about 2,600 URLs. These URLs copy the parameters the dashboard sends. If you change the parameters a component sends, update `warmUrls()` as well, or those requests become slow cache misses.

**The dashboard is one page.** `pages/dashboard.tsx` owns the view and passes filters to the panels in `components/`. Each panel fetches its own data through the generated hooks. The view state (`lib/view-state.ts`) is mirrored into the URL query string, and links depend on it, so a new filter belongs there. Charts use Recharts, and the map uses Leaflet.

**The data pipeline's rules are shown to users.** `scripts/build_paris_sales.py` decides which DVF rows count as one sale, and it records its exclusion counts in the dataset's `filters` field. `salesData.ts` sums selected counts into `excludedCount`, which the dashboard's data note displays. If you change the rules, update that sum, the note and the README.

## Things that look wrong but are explained

- This project came from a Replit template. `lib/db`, `scripts/src/hello.ts`, the root `@replit/connectors-sdk` dependency and the `@replit/*` Vite plugins are leftovers. Nothing imports `@workspace/db` or the connectors SDK. Most of `components/ui/` is an unused UI kit, so check for imports before you rely on or edit a component there.
- `pnpm-workspace.yaml` still has `'-'` overrides for `@expo/ngrok-bin`. They do no harm. Do not restore the overrides for `rollup`, `esbuild`, `lightningcss` or `@tailwindcss/oxide`, because those break the build on every platform except Linux x64.
- `minimumReleaseAge: 1440` in `pnpm-workspace.yaml` makes pnpm reject package versions published less than a day ago.
