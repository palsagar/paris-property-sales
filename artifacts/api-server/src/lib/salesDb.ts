import { DuckDBInstance } from "@duckdb/node-api";

export type SqlParams = Record<string, string | number>;

export interface SalesDb {
  query<T>(sql: string, params?: SqlParams): Promise<T[]>;
}

/**
 * The longest a query may run. Queries usually take 10 to 60 ms, so only a fault or an overloaded server reaches this.
 * The query is then stopped, so it cannot hold DuckDB's threads, and the API answers 503 (app.ts).
 */
export const QUERY_TIMEOUT_MS = 5000;

/** Opens the Sales file read-only. Each query uses its own connection. */
export async function openSalesDb(file: string, timeoutMs = QUERY_TIMEOUT_MS): Promise<SalesDb> {
  const instance = await DuckDBInstance.create(file, { access_mode: "READ_ONLY" });
  return {
    async query<T>(sql: string, params?: SqlParams): Promise<T[]> {
      const connection = await instance.connect();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        connection.interrupt();
      }, timeoutMs);
      try {
        const result = await connection.runAndReadAll(sql, params);
        return result.getRowObjects() as T[];
      } catch (e) {
        throw timedOut ? new QueryTimeoutError(timeoutMs) : e;
      } finally {
        clearTimeout(timer);
        connection.disconnectSync();
      }
    },
  };
}

export class QueryTimeoutError extends Error {
  constructor(ms: number) {
    super(`The query took more than ${ms} ms`);
  }
}
