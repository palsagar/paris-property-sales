import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { openSalesDb } from "./salesDb";
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
