# Paris Property Sales since 2022

Dashboard of private residential sales in Paris (apartments and houses), January 2022 to June 2026, built from the DVF open data (Demandes de valeurs foncières, DGFiP). It has a map by arrondissement and quartier, a price trend chart, a heat map, ranked areas, price distributions and a list of individual sales.

This package contains the full source, the cleaned dataset the app reads, and the raw files the dataset was built from. No database, login or API key is needed.

## What is in the package

| Path | What it is |
| --- | --- |
| `artifacts/data-app` | The React dashboard (Vite, Tailwind, Recharts, Leaflet) |
| `artifacts/api-server` | The Express API. It reads `artifacts/api-server/data/*` into memory at start |
| `artifacts/api-server/data` | The cleaned dataset: `paris-sales.json` (128,114 sales) and the arrondissement and quartier boundaries as GeoJSON |
| `data-raw` | The raw inputs: DVF yearly CSV files for Paris (`src/paris-*.csv`) and boundary GeoJSON files |
| `scripts/build_paris_sales.py` | Rebuilds `artifacts/api-server/data` from `data-raw` (Python 3, standard library only) |
| `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` | The API contract (OpenAPI) and the generated client and validators shared by the two apps |
| `Dockerfile`, `docker-compose.yml` | One container that serves the dashboard and the API on port 3000 |

## Option 1: Docker (simplest)

```
docker compose up --build -d
```

Open http://localhost:3000. The container serves the dashboard at `/` and the API at `/api`. Put it behind your own reverse proxy and TLS as usual (the app is stateless; any port can be mapped in `docker-compose.yml`).

Without compose:

```
docker build -t paris-sales .
docker run -d -p 3000:3000 --restart unless-stopped paris-sales
```

Health check: `GET /api/healthz`.

## Option 2: Node, without Docker

Requirements: Node.js 24 (22 or later should work) and pnpm 10 (`npm install -g pnpm@10`).

```
pnpm install --frozen-lockfile
BASE_PATH=/ PORT=3000 pnpm --filter @workspace/data-app run build
NODE_ENV=production pnpm --filter @workspace/api-server run build

# start (run from artifacts/api-server so the data folder is found next to dist)
cd artifacts/api-server
NODE_ENV=production PORT=3000 STATIC_DIR=../data-app/dist/public node dist/index.mjs
```

Open http://localhost:3000.

The runtime only needs three things side by side: `dist/` (the built API), `data/` and the built dashboard folder (`STATIC_DIR`). You can copy those to a server and run `node dist/index.mjs` there; `node_modules` is not needed at runtime.

## Option 3: Dashboard and API on separate hosts

Build the dashboard (`pnpm --filter @workspace/data-app run build`) and serve `artifacts/data-app/dist/public` from any static host, with every unknown path rewritten to `/index.html`. The dashboard calls the API at the relative path `/api/...`, so route `/api` on the same domain to the Node API server (start it without `STATIC_DIR`). If the dashboard must live under a sub-path, set `BASE_PATH` (for example `/paris/`) at build time and route the API accordingly.

## Environment variables

| Variable | Used by | Meaning |
| --- | --- | --- |
| `PORT` | API server | Port to listen on (required) |
| `STATIC_DIR` | API server | Folder with the built dashboard. If unset, only the API is served |
| `NODE_ENV` | API server | Use `production` |
| `LOG_LEVEL` | API server | Optional, default `info` |
| `BASE_PATH` | dashboard build | URL prefix of the dashboard, `/` by default in this package |

## Things to know

- On start, the server loads the dataset and pre-computes about 2,600 common responses, which takes roughly 15 seconds of CPU. The API answers during that time, but the first requests can be slower. Responses are cached in memory, so restart the server after you change the dataset. Memory use is a few hundred MB; give the container at least 1 GB.
- The browser loads fonts from Google Fonts (Fraunces, IBM Plex) and map tiles from Esri (Esri World Light Gray and Dark Gray canvases). The visitor's browser needs internet access to these two services for the page to look exactly like the original. To self-host the fonts, download them and replace the `@import url(...)` line at the top of `artifacts/data-app/src/index.css`. Check Esri's terms of use for your traffic level, or replace the tile URL in `artifacts/data-app/src/components/sales-map.tsx` with another provider.
- Data coverage ends on 30 June 2026 because the DVF release for the second half of 2026 is not published yet. Prices are nominal euros.
- A sale in the dataset is one DVF "Vente" transaction with exactly one apartment or house and no commercial premises, priced 20,000 to 20,000,000 EUR, on 9 to 300 m², at 2,000 to 35,000 EUR/m². Price per m² uses built surface. About 28,400 residential transactions are left out by these rules, and the app says so in its data note.

## Updating the data

1. Put the new DVF yearly CSV files (filtered to department 75, from data.gouv.fr "Demandes de valeurs foncières géolocalisées") in `data-raw/src/` named `paris-*.csv` (the script reads every file in that folder whose name starts with `paris-` and ends in `.csv`).
2. Run `python3 scripts/build_paris_sales.py`. It rewrites the three files in `artifacts/api-server/data/`.
3. Rebuild the API (`pnpm --filter @workspace/api-server run build`) or the Docker image, and restart. If the data now ends on a different date, update the text in `artifacts/data-app/index.html` and in the intro of `artifacts/data-app/src/pages/dashboard.tsx`, and the year list in `artifacts/api-server/src/lib/prewarm.ts`.

## Changing the API

The API contract is `lib/api-spec/openapi.yaml`. After editing it, run `pnpm --filter @workspace/api-spec run codegen` to regenerate the client hooks (`lib/api-client-react`) and the validators (`lib/api-zod`). The dashboard has `pnpm run typecheck` at the repository root.

## Sources and licences

DVF: DGFiP, published on data.gouv.fr under the Licence Ouverte (Etalab). Arrondissement and quartier boundaries: Paris Open Data. Check the current licence terms of each source before commercial use or redistribution.
