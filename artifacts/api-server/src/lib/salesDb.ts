import { DuckDBInstance } from "@duckdb/node-api";

export type SqlParams = Record<string, string | number>;

export interface SalesDb {
  query<T>(sql: string, params?: SqlParams): Promise<T[]>;
}

/** Opens the Sales file read-only. Each query uses its own connection. */
export async function openSalesDb(file: string): Promise<SalesDb> {
  const instance = await DuckDBInstance.create(file, { access_mode: "READ_ONLY" });
  return {
    async query<T>(sql: string, params?: SqlParams): Promise<T[]> {
      const connection = await instance.connect();
      try {
        const result = await connection.runAndReadAll(sql, params);
        return result.getRowObjects() as T[];
      } finally {
        connection.disconnectSync();
      }
    },
  };
}
