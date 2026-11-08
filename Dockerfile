# Paris & Suburbs Property Sales: one container serves the dashboard and the API on one port.
FROM node:24-slim AS build
RUN npm install -g pnpm@10.26.1
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
# The dashboard is served from the site root, so BASE_PATH is "/".
# PORT is only required by the Vite config; it is not used for the production build.
RUN BASE_PATH=/ PORT=3000 pnpm --filter @workspace/data-app run build
RUN NODE_ENV=production pnpm --filter @workspace/api-server run build
# The bundle does not include the DuckDB package, because it is a native module.
# Install it in a folder outside /app, because the root package.json rejects npm.
# The version comes from the API server's package.json, so the pin lives in one place.
RUN mkdir /runtime && cd /runtime && npm install --no-package-lock --omit=dev \
  "@duckdb/node-api@$(node -p "require('/app/artifacts/api-server/package.json').dependencies['@duckdb/node-api']")"

FROM node:24-slim
ENV NODE_ENV=production \
    PORT=3000 \
    STATIC_DIR=/app/public \
    SITE_URL=https://parism2.gpuphysics.dev
WORKDIR /app
COPY --from=build /app/artifacts/api-server/dist ./dist
COPY --from=build /app/artifacts/api-server/boundaries ./boundaries
COPY --from=build /runtime/node_modules ./node_modules
# The image holds no sales data. Mount a folder with sales.duckdb at /app/data at run time.
COPY --from=build /app/artifacts/data-app/dist/public ./public
EXPOSE 3000
# This image has no curl or wget, so Node makes the health request.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/api/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Node must start in /app so ./dist/index.mjs finds ../data and ../boundaries
CMD ["node", "--enable-source-maps", "dist/index.mjs"]
