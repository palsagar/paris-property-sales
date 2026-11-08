import { gzipSync } from "node:zlib";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import {
  GetAreaTrendQueryParams,
  GetPriceDistributionQueryParams,
  GetPricePerSqmDistributionQueryParams,
  GetSalesByArrondissementQueryParams,
  GetSalesByCommuneQueryParams,
  GetSalesByQuartierQueryParams,
  GetSalesByRoomsQueryParams,
  GetSalesPointsQueryParams,
  GetSalesSummaryQueryParams,
  GetSalesTrendQueryParams,
  ListTransactionsQueryParams,
} from "@workspace/api-zod";

interface Entry {
  body: string;
  gzip?: Buffer;
  bytes: number;
}

/** The response of a request that others with the same key waited for. */
interface Shared {
  status: number;
  body: string;
}

// The warm-up fills about 12 MB. The largest response, every Sale on the map, is
// about 24 MB, so this holds several of those on top of the warm-up.
const MAX_CACHE_BYTES = 256 * 1024 * 1024;

// How long a run may go on after its own Visitor has left. Longer than the query time limit in salesDb.ts.
const ABANDONED_RUN_MS = 10_000;

const NO_QUERY = z.object({});

// The paths that can be cached, each with the validator its route applies to
// the same query. A path that is not listed here is never cached.
const QUERY_SCHEMAS = new Map<string, ZodTypeAny>([
  ["/sales/summary", GetSalesSummaryQueryParams],
  ["/sales/price-distribution", GetPriceDistributionQueryParams],
  ["/sales/price-per-sqm-distribution", GetPricePerSqmDistributionQueryParams],
  ["/sales/trend", GetSalesTrendQueryParams],
  ["/sales/area-trend", GetAreaTrendQueryParams],
  ["/sales/by-rooms", GetSalesByRoomsQueryParams],
  ["/sales/by-arrondissement", GetSalesByArrondissementQueryParams],
  ["/sales/by-quartier", GetSalesByQuartierQueryParams],
  ["/sales/by-commune", GetSalesByCommuneQueryParams],
  ["/sales/points", GetSalesPointsQueryParams],
  ["/sales/transactions", ListTransactionsQueryParams],
  ["/geo/arrondissements", NO_QUERY],
  ["/geo/quartiers", NO_QUERY],
  ["/geo/communes", NO_QUERY],
]);

// The key is the validated query, which is exactly what the route acts on. Two
// requests share an entry only if the route would treat them the same, so
// unknown parameters and different spellings of a value add no entries. A query
// that fails validation returns null, and the route then rejects it. Express
// ignores case and one trailing slash when it routes, so the key does too.
function cacheKey(req: Request): string | null {
  const path = req.path.toLowerCase().replace(/(.)\/$/, "$1");
  const query = QUERY_SCHEMAS.get(path)?.safeParse(req.query);
  return query?.success ? `${path}?${JSON.stringify(query.data)}` : null;
}

// The dataset is static for the lifetime of the process, so a response only
// depends on the validated query. Map keeps insertion order, which is used as LRU.
export function createResponseCache(maxBytes = MAX_CACHE_BYTES): RequestHandler {
  const cache = new Map<string, Entry>();
  // Requests that are running, by key. A request with the same key waits for the
  // running one and gets its response, so the query runs once.
  const running = new Map<string, Promise<Shared | null>>();
  let totalBytes = 0;

  function evict(): void {
    while (totalBytes > maxBytes) {
      const oldest = cache.entries().next();
      if (oldest.done) return;
      const [key, entry] = oldest.value;
      totalBytes -= entry.bytes;
      cache.delete(key);
    }
  }

  function sendHit(req: Request, res: Response, key: string, hit: Entry): void {
    // refresh LRU position
    cache.delete(key);
    cache.set(key, hit);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.setHeader("X-Cache", "HIT");
    res.setHeader("Vary", "Accept-Encoding");
    if (req.acceptsEncodings("gzip") && hit.body.length > 1024) {
      const gzip = hit.gzip ?? gzipSync(hit.body, { level: 4 });
      if (!hit.gzip) {
        hit.gzip = gzip;
        hit.bytes += gzip.length;
        totalBytes += gzip.length;
        evict();
      }
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", gzip.length);
      res.end(gzip);
    } else {
      res.end(hit.body);
    }
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "GET") {
      next();
      return;
    }
    const key = cacheKey(req);
    if (key === null) {
      next();
      return;
    }
    const hit = cache.get(key);
    if (hit) {
      sendHit(req, res, key, hit);
      return;
    }
    const pending = running.get(key);
    if (pending) {
      void pending.then((shared) => {
        const entry = cache.get(key);
        if (entry) {
          sendHit(req, res, key, entry);
        } else if (shared) {
          // An error, or a response too large to cache: shared once, not stored.
          if (shared.status === 200) res.setHeader("Cache-Control", "public, max-age=300");
          res.setHeader("X-Cache", "SHARED");
          res.status(shared.status).type("application/json").send(shared.body);
        } else {
          // The running request ended without a response, so this one runs the route itself.
          next();
        }
      });
      return;
    }
    let settle!: (shared: Shared | null) => void;
    const result = new Promise<Shared | null>((resolve) => (settle = resolve));
    running.set(key, result);
    const finish = (shared: Shared | null) => {
      if (running.get(key) === result) running.delete(key);
      settle(shared);
    };
    // A Visitor who leaves does not stop the route, which still answers through res.json below and then ends the wait.
    // Ending it at once would send every waiting request to run the route itself. The timer is for a route that never
    // answers.
    res.on("close", () => {
      if (res.writableFinished) finish(null);
      else setTimeout(() => finish(null), ABANDONED_RUN_MS).unref();
    });

    const originalJson = res.json.bind(res);
    res.json = (payload: unknown) => {
      if (res.statusCode === 200) {
        const body = JSON.stringify(payload);
        const bytes = Buffer.byteLength(body);
        // A response over the limit would push out every other entry and then itself.
        if (bytes <= maxBytes) {
          // Overlapping misses on one key each store a response here.
          const previous = cache.get(key);
          if (previous) totalBytes -= previous.bytes;
          cache.set(key, { body, bytes });
          totalBytes += bytes;
          evict();
        }
        finish({ status: 200, body });
        res.setHeader("Cache-Control", "public, max-age=300");
        res.setHeader("X-Cache", "MISS");
        res.type("application/json");
        return res.send(body);
      }
      finish({ status: res.statusCode, body: JSON.stringify(payload) });
      return originalJson(payload);
    };
    next();
  };
}

export const responseCache = createResponseCache();
