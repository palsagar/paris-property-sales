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
      const run = connection.runAndReadAll(sql, params).then((result) => result.getRowObjects() as T[]);
      let timer: NodeJS.Timeout | undefined;
      let interrupter: NodeJS.Timeout | undefined;
      const expired = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new QueryTimeoutError(timeoutMs));
          // A query that waits for a DuckDB thread has not started, and an interrupt before the start does nothing,
          // so the interrupt is repeated until the query ends.
          connection.interrupt();
          interrupter = setInterval(() => connection.interrupt(), 25);
        }, timeoutMs);
      });
      // The connection closes only after the query has ended, because closing it under a running query is unsafe.
      void run.then(undefined, () => undefined).then(() => {
        clearTimeout(timer);
        clearInterval(interrupter);
        connection.disconnectSync();
      });
      return Promise.race([run, expired]);
    },
  };
}

export class QueryTimeoutError extends Error {
  constructor(ms: number) {
    super(`The query took more than ${ms} ms`);
  }
}
