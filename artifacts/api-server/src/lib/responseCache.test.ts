import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, describe, test } from "node:test";
import express from "express";
import { GetSalesSummaryQueryParams } from "@workspace/api-zod";
import { createResponseCache } from "./responseCache";

const servers: Server[] = [];

/** Serves one cache in front of routes that behave like the real ones. */
async function startApp(maxBytes?: number): Promise<string> {
  const app = express();
  const routes = express.Router();
  // Echoes what the route understood, so a test can see which query produced a response.
  routes.get("/sales/summary", (req, res) => {
    const parsed = GetSalesSummaryQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "rejected by the route" });
      return;
    }
    res.json({ query: parsed.data });
  });
  // Returns a body of a chosen size. The `to` parameter picks the size in bytes.
  routes.get("/sales/by-rooms", (req, res) => {
    const size = Number(String(req.query["to"]).slice(0, 4));
    res.json({ padding: randomBytes(Math.ceil(size / 2)).toString("hex") });
  });
  // Waits before it answers, as a route does when it queries the Sales file.
  routes.get("/sales/by-arrondissement", async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    res.json({ padding: "x".repeat(1000) });
  });
  routes.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });
  app.use("/api", createResponseCache(maxBytes), routes);

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}

after(() => {
  for (const server of servers) server.close();
});

async function get(url: string, encoding = "identity") {
  const res = await fetch(url, { headers: { "Accept-Encoding": encoding } });
  const body = (await res.json()) as { query: { propertyType: string }; error?: string };
  return { status: res.status, cache: res.headers.get("x-cache"), body };
}

/** A request for /sales/by-rooms whose response is about `size` bytes. */
function sizedUrl(base: string, size: number, from = "2024-01-01"): string {
  return `${base}/sales/by-rooms?from=${from}&to=${String(size).padStart(4, "0")}-01-01`;
}

describe("cache key", () => {
  test("a double question mark cannot store a response under a filtered key", async () => {
    const base = await startApp();

    // Express reads this as a parameter named "?propertyType", which the route ignores.
    const malformed = await get(`${base}/sales/summary??propertyType=Maison`);
    assert.equal(malformed.body.query.propertyType, "all");

    const filtered = await get(`${base}/sales/summary?propertyType=Maison`);
    assert.equal(filtered.body.query.propertyType, "Maison");
  });

  test("unknown parameters share one entry", async () => {
    const base = await startApp();

    assert.equal((await get(`${base}/sales/summary?junk=1`)).cache, "MISS");
    assert.equal((await get(`${base}/sales/summary?junk=2`)).cache, "HIT");
  });

  test("values that validate to the same query share one entry", async () => {
    const base = await startApp();

    assert.equal((await get(`${base}/sales/summary?arrondissement=6`)).cache, "MISS");
    assert.equal((await get(`${base}/sales/summary?arrondissement=06`)).cache, "HIT");
  });

  test("different queries keep separate entries", async () => {
    const base = await startApp();

    await get(`${base}/sales/summary?propertyType=Maison`);
    const other = await get(`${base}/sales/summary?propertyType=Appartement`);
    assert.equal(other.cache, "MISS");
    assert.equal(other.body.query.propertyType, "Appartement");
  });

  test("an invalid query reaches the route and is not cached", async () => {
    const base = await startApp();

    const first = await get(`${base}/sales/summary?propertyType=Castle`);
    assert.equal(first.status, 400);
    assert.equal(first.body.error, "rejected by the route");
    const second = await get(`${base}/sales/summary?propertyType=Castle`);
    assert.equal(second.status, 400);
    assert.equal(second.cache, null);
  });

  test("a path with no known query is not cached", async () => {
    const base = await startApp();

    await get(`${base}/healthz`);
    assert.equal((await get(`${base}/healthz`)).cache, null);
  });
});

describe("byte limit", () => {
  test("the oldest entry is removed when the limit is passed", async () => {
    const base = await startApp(1000);
    const older = sizedUrl(base, 600, "2024-01-01");
    const newer = sizedUrl(base, 600, "2024-01-02");

    await get(older);
    await get(newer);

    assert.equal((await get(newer)).cache, "HIT");
    assert.equal((await get(older)).cache, "MISS");
  });

  test("a response larger than the limit does not push out other entries", async () => {
    const base = await startApp(1000);
    const small = sizedUrl(base, 500, "2024-01-01");
    const huge = sizedUrl(base, 2000, "2024-01-02");

    await get(small);
    await get(huge);

    assert.equal((await get(huge)).cache, "MISS");
    assert.equal((await get(small)).cache, "HIT");
  });

  test("gzip copies count towards the limit", async () => {
    const base = await startApp(5000);
    const compressed = sizedUrl(base, 3000, "2024-01-01");
    const other = sizedUrl(base, 1500, "2024-01-02");

    await get(compressed);
    await get(other);
    // The two bodies fit under the limit. The stored gzip copy pushes the total over it.
    await get(compressed, "gzip");

    assert.equal((await get(compressed)).cache, "HIT");
    assert.equal((await get(other)).cache, "MISS");
  });

  test("overlapping misses on one key do not stop later responses from being cached", async () => {
    const base = await startApp(2500);
    const url = (day: number) => `${base}/sales/by-arrondissement?from=2024-01-0${day}`;

    // Both requests miss, so both responses are stored under the same key.
    for (const day of [2, 3, 4]) {
      await Promise.all([get(url(day)), get(url(day))]);
    }

    for (const day of [5, 6]) {
      assert.equal((await get(url(day))).cache, "MISS");
      assert.equal((await get(url(day))).cache, "HIT");
    }
  });
});
