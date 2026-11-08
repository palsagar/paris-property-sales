import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { DuckDBInstance } from "@duckdb/node-api";
import { openSalesDb, QueryTimeoutError } from "./salesDb";
import { createSalesFixture, FIXTURE_SALES } from "./salesFixture";

test("50 queries at once all succeed and return their own result", async () => {
  const db = await createSalesFixture(FIXTURE_SALES);
  const rows = await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      db.query<{ n: number }>("SELECT $i::INTEGER AS n FROM sales LIMIT 1", { i }),
    ),
  );
  assert.deepEqual(rows.map((r) => r[0]!.n), Array.from({ length: 50 }, (_, i) => i));
});

test("openSalesDb rejects for a missing file", async () => {
  await assert.rejects(openSalesDb(join(tmpdir(), "no-such-sales-file.duckdb")));
});

test("a write through query is rejected and the file keeps its 5 rows", async () => {
  const db = await createSalesFixture(FIXTURE_SALES);
  await assert.rejects(db.query("DELETE FROM sales"));
  const rows = await db.query<{ n: bigint }>("SELECT count(*) AS n FROM sales");
  assert.equal(rows[0]!.n, 5n);
});

test("a query past the time limit is stopped, rejects with QueryTimeoutError, and later queries still run", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "sales-timeout-")), "empty.duckdb");
  (await DuckDBInstance.create(file)).closeSync();
  const db = await openSalesDb(file, 100);

  const started = Date.now();
  // About 10 billion rows: this runs for minutes unless it is stopped.
  await assert.rejects(db.query("SELECT sum(range % 7) FROM range(10000000000)"), QueryTimeoutError);
  assert.ok(Date.now() - started < 2000, `stopped after ${Date.now() - started} ms`);

  const rows = await db.query<{ n: number }>("SELECT 1::INTEGER AS n");
  assert.equal(rows[0]!.n, 1);
});

test("many slow queries at once all stop near the time limit, including those still waiting for a thread", async () => {
  const file = join(mkdtempSync(join(tmpdir(), "sales-timeout-")), "empty.duckdb");
  (await DuckDBInstance.create(file)).closeSync();
  const db = await openSalesDb(file, 200);

  const started = Date.now();
  const results = await Promise.allSettled(
    Array.from({ length: 24 }, (_, i) =>
      db.query("SELECT sum(range % 7) + $i::INTEGER FROM range(10000000000)", { i }),
    ),
  );
  assert.ok(results.every((r) => r.status === "rejected" && r.reason instanceof QueryTimeoutError));
  assert.ok(Date.now() - started < 3000, `stopped after ${Date.now() - started} ms`);

  const rows = await db.query<{ n: number }>("SELECT 1::INTEGER AS n");
  assert.equal(rows[0]!.n, 1);
});
