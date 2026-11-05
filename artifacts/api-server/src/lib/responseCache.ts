import { gzipSync } from "node:zlib";
import type { NextFunction, Request, Response } from "express";

interface Entry {
  body: string;
  gzip?: Buffer;
}

const MAX_ENTRIES = 6000;
const MAX_LARGE_ENTRIES = 24;
const LARGE_BODY_BYTES = 200_000;

// The dataset is static for the lifetime of the process, so a response only
// depends on the request URL. Map keeps insertion order, which is used as LRU.
const cache = new Map<string, Entry>();
let largeCount = 0;

function cacheKey(req: Request): string {
  const params = new URLSearchParams(
    req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "",
  );
  params.sort();
  return `${req.path}?${params.toString()}`;
}

function evict(): void {
  while (cache.size > MAX_ENTRIES || largeCount > MAX_LARGE_ENTRIES) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    const entry = cache.get(oldest.value);
    if (entry && entry.body.length > LARGE_BODY_BYTES) largeCount -= 1;
    cache.delete(oldest.value);
  }
}

export function responseCache(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method !== "GET") {
    next();
    return;
  }
  const key = cacheKey(req);
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
      hit.gzip ??= gzipSync(hit.body, { level: 4 });
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", hit.gzip.length);
      res.end(hit.gzip);
    } else {
      res.end(hit.body);
    }
    return;
  }

  const originalJson = res.json.bind(res);
  res.json = (payload: unknown) => {
    if (res.statusCode === 200) {
      const body = JSON.stringify(payload);
      cache.set(key, { body });
      if (body.length > LARGE_BODY_BYTES) largeCount += 1;
      evict();
      res.setHeader("Cache-Control", "public, max-age=300");
      res.setHeader("X-Cache", "MISS");
      res.type("application/json");
      return res.send(body);
    }
    return originalJson(payload);
  };
  next();
}
