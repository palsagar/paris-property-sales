import { gzipSync } from "node:zlib";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { z, type ZodTypeAny } from "zod";
import {
  GetAreaTrendQueryParams,
  GetPriceDistributionQueryParams,
  GetPricePerSqmDistributionQueryParams,
  GetSalesByArrondissementQueryParams,
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

// The warm-up fills about 12 MB. The largest response, every Sale on the map, is
// about 24 MB, so this holds several of those on top of the warm-up.
const MAX_CACHE_BYTES = 256 * 1024 * 1024;

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
  ["/sales/points", GetSalesPointsQueryParams],
  ["/sales/transactions", ListTransactionsQueryParams],
  ["/geo/arrondissements", NO_QUERY],
  ["/geo/quartiers", NO_QUERY],
]);

// The key is the validated query, which is exactly what the route acts on. Two
// requests share an entry only if the route would treat them the same, so
// unknown parameters and different spellings of a value add no entries. A query
// that fails validation returns null, and the route then rejects it.
function cacheKey(req: Request): string | null {
  const query = QUERY_SCHEMAS.get(req.path)?.safeParse(req.query);
  return query?.success ? `${req.path}?${JSON.stringify(query.data)}` : null;
}

// The dataset is static for the lifetime of the process, so a response only
// depends on the validated query. Map keeps insertion order, which is used as LRU.
export function createResponseCache(maxBytes = MAX_CACHE_BYTES): RequestHandler {
  const cache = new Map<string, Entry>();
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
      // refresh LRU position
      cache.delete(key);
      cache.set(key, hit);
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Vary", "Accept-Encoding");
      const acceptsGzip = /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
      if (acceptsGzip && hit.body.length > 1024) {
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
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (payload: unknown) => {
      if (res.statusCode === 200) {
        const body = JSON.stringify(payload);
        const bytes = Buffer.byteLength(body);
        // A response over the limit would push out every other entry and then itself.
        if (bytes <= maxBytes) {
          cache.set(key, { body, bytes });
          totalBytes += bytes;
          evict();
        }
        res.setHeader("Cache-Control", "public, max-age=300");
        res.setHeader("X-Cache", "MISS");
        res.type("application/json");
        return res.send(body);
      }
      return originalJson(payload);
    };
    next();
  };
}

export const responseCache = createResponseCache();
