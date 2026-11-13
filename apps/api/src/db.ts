import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Minimal DB surface so production (pg) and tests/dev (PGlite) share all code. */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs a multi-statement SQL script (migrations). No parameters. */
  exec(sql: string): Promise<void>;
  tx<R>(fn: (db: Db) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

export async function openPg(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  // Without this listener an error on an idle connection (database restart, network blip) is an
  // unhandled 'error' event and kills the whole process. The pool simply opens a new connection.
  pool.on("error", (e) => console.error("[pg] idle client error:", e.message));
  const wrap = (c: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Omit<Db, "tx" | "close"> => ({
    async query<T>(sql: string, params?: unknown[]) {
      return (await c.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await c.query(sql);
    },
  });
  const db: Db = {
    ...wrap(pool),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const inner: Db = { ...wrap(client), tx: (f) => f(inner), close: async () => {} };
        const r = await fn(inner);
        await client.query("COMMIT");
        return r;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  return db;
}

export async function openMemory(): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  const lite = new PGlite();
  const db: Db = {
    async query<T>(sql: string, params?: unknown[]) {
      return (await lite.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await lite.exec(sql);
    },
    async tx(fn) {
      return lite.transaction(async (t) => {
        const inner: Db = {
          async query<T>(sql: string, params?: unknown[]) {
            return (await t.query(sql, params)).rows as T[];
          },
          async exec(sql: string) {
            await t.exec(sql);
          },
          tx: (f) => f(inner),
          close: async () => {},
        };
        return fn(inner);
      });
    },
    close: () => lite.close(),
  };
  return db;
}

/** Applies migrations/*.sql in filename order, once each. Safe to run on every boot. */
export async function migrate(db: Db, dir?: string): Promise<string[]> {
  const folder = dir ?? join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const done = new Set((await db.query<{ name: string }>("SELECT name FROM schema_migrations")).map((r) => r.name));
  const files = (await readdir(folder)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await readFile(join(folder, f), "utf8");
    await db.tx(async (t) => {
      await t.exec(sql);
      await t.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}
