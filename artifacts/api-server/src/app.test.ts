import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, test } from "node:test";
import express from "express";
import { createApp } from "./app";
import { API_RATE_LIMIT } from "./lib/rateLimit";
import { QueryTimeoutError } from "./lib/salesDb";

const servers: Server[] = [];

after(() => {
  for (const server of servers) server.close();
});

/** Routes that stand in for the real API, so the app runs without the Sales file. */
function stubRoutes(): express.Router {
  const routes = express.Router();
  routes.get("/ip", (req, res) => {
    res.json({ ip: req.ip });
  });
  routes.post("/body", (req, res) => {
    res.json({ body: req.body ?? null });
  });
  routes.get("/slow", () => {
    throw new QueryTimeoutError(5000);
  });
  return routes;
}

async function start(env: NodeJS.ProcessEnv = {}): Promise<string> {
  const app = createApp(stubRoutes(), env);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function ipOf(base: string, headers: Record<string, string>): Promise<string> {
  const res = await fetch(`${base}/api/ip`, { headers });
  return ((await res.json()) as { ip: string }).ip;
}

describe("headers", () => {
  test("no response allows other origins to read it", async () => {
    const base = await start();
    const res = await fetch(`${base}/api/ip`, { headers: { Origin: "https://other.example" } });
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  });

  test("no page may be shown in a frame", async () => {
    const base = await start();
    const res = await fetch(`${base}/api/ip`);
    assert.equal(res.headers.get("content-security-policy"), "frame-ancestors 'none'");
    assert.equal(res.headers.get("x-frame-options"), "DENY");
  });
});

test("the server does not read request bodies", async () => {
  const base = await start();
  const res = await fetch(`${base}/api/body`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ a: 1 }),
  });
  assert.deepEqual(await res.json(), { body: null });
});

test("a query that takes too long gives 503", async () => {
  const base = await start();
  const res = await fetch(`${base}/api/slow`);
  assert.equal(res.status, 503);
  assert.match(((await res.json()) as { error: string }).error, /too long/);
});

describe("visitor address", () => {
  // The test's requests come from 127.0.0.1, which stands in for Traefik.
  test("the address Traefik received the request from", async () => {
    const base = await start();
    assert.equal(await ipOf(base, { "X-Forwarded-For": "203.0.113.7" }), "203.0.113.7");
  });

  test("an address the client wrote in X-Forwarded-For is ignored", async () => {
    const base = await start();
    assert.equal(await ipOf(base, { "X-Forwarded-For": "198.51.100.1, 203.0.113.7" }), "203.0.113.7");
  });

  test("CF-Connecting-IP when the request came through Cloudflare", async () => {
    const base = await start();
    assert.equal(
      await ipOf(base, { "X-Forwarded-For": "173.245.48.5", "CF-Connecting-IP": "198.51.100.9" }),
      "198.51.100.9",
    );
    assert.equal(
      await ipOf(base, { "X-Forwarded-For": "2606:4700::1", "CF-Connecting-IP": "2001:db8::1" }),
      "2001:db8::1",
    );
  });

  test("CF-Connecting-IP is ignored when the request did not come through Cloudflare", async () => {
    const base = await start();
    assert.equal(
      await ipOf(base, { "X-Forwarded-For": "203.0.113.7", "CF-Connecting-IP": "198.51.100.9" }),
      "203.0.113.7",
    );
  });

  test("a CF-Connecting-IP that is not an address is ignored", async () => {
    const base = await start();
    assert.equal(
      await ipOf(base, { "X-Forwarded-For": "173.245.48.5", "CF-Connecting-IP": "not-an-ip" }),
      "173.245.48.5",
    );
  });
});

describe("rate limit", () => {
  async function burst(base: string, headers: Record<string, string>, count: number): Promise<Response[]> {
    const responses: Response[] = [];
    for (let i = 0; i < count; i += 50) {
      const batch = await Promise.all(
        Array.from({ length: Math.min(50, count - i) }, () => fetch(`${base}/api/ip`, { headers })),
      );
      for (const res of batch) await res.arrayBuffer();
      responses.push(...batch);
    }
    return responses;
  }

  test("a visitor over the limit gets 429 with Retry-After", async () => {
    const base = await start();
    const visitor = { "X-Forwarded-For": "203.0.113.7" };
    const responses = await burst(base, visitor, API_RATE_LIMIT.limit);
    assert.ok(responses.every((r) => r.status === 200));

    const over = await fetch(`${base}/api/ip`, { headers: visitor });
    assert.equal(over.status, 429);
    assert.ok(Number(over.headers.get("retry-after")) > 0);
    assert.match(((await over.json()) as { error: string }).error, /Too many requests/);

    const other = await fetch(`${base}/api/ip`, { headers: { "X-Forwarded-For": "203.0.113.8" } });
    assert.equal(other.status, 200);
  });

  test("requests from the machine itself are never limited", async () => {
    const base = await start();
    const responses = await burst(base, {}, API_RATE_LIMIT.limit + 1);
    assert.ok(responses.every((r) => r.status === 200));
  });

  test("a request through a proxy is limited even when the address it names is private", async () => {
    const base = await start();
    for (const headers of [{ "X-Forwarded-For": "192.168.65.1" }, { "CF-Connecting-IP": "127.0.0.1" }]) {
      const responses = await burst(base, headers, API_RATE_LIMIT.limit + 1);
      assert.equal(responses[responses.length - 1]?.status, 429);
    }
  });
});

describe("page", () => {
  function site(): string {
    const root = mkdtempSync(join(tmpdir(), "site-"));
    writeFileSync(join(root, "index.html"), "<html><head></head><body>raw</body></html>");
    mkdirSync(join(root, "assets"));
    writeFileSync(join(root, "assets", "app.js"), "console.log(1)");
    return root;
  }

  for (const path of ["/", "/index.html", "/%69ndex.html", "/INDEX.HTML", "/%2findex.html", "/assets%2f..%2findex.html"]) {
    test(`${path} gives the processed page`, async () => {
      const base = await start({ STATIC_DIR: site(), SITE_URL: "https://example.test" });
      const res = await fetch(`${base}${path}`);
      assert.equal(res.status, 200);
      assert.match(await res.text(), /og:url/);
    });
  }

  test("other files are served as they are", async () => {
    const base = await start({ STATIC_DIR: site(), SITE_URL: "https://example.test" });
    const res = await fetch(`${base}/assets/app.js`);
    assert.equal(await res.text(), "console.log(1)");
  });
});
