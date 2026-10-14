import { AsyncLocalStorage } from "node:async_hooks";

import type { Logger } from "drizzle-orm";
import { getTableName } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { PgTable } from "drizzle-orm/pg-core";
import { Pool, types } from "pg";

import { DATABASE_URL } from "@sofa/config";
import { createLogger } from "@sofa/logger";

import * as schema from "./schema";

const log = createLogger("drizzle");

// 08.10, real bug found live (Patoune TV, against migrated data): `pg`
// returns bigint (OID 20, e.g. every raw `count(*)`/`count(distinct ...)`
// aggregate) and numeric (OID 1700, e.g. `avg(...)`) columns as STRINGS by
// default, to avoid silent precision loss on values bigger than
// Number.MAX_SAFE_INTEGER. Every `sql<number>`...`` cast in this codebase
// (getEpisodeProgressByTitleIds, getRatingStats, etc.) only asserts the
// TypeScript type — it does nothing at the SQL/driver level — so those
// columns were actually arriving as strings and failing oRPC's Zod output
// validation (library.list: "watched"/"total" expected number, got
// string). None of our counts ever approach bigint's real range, so
// parsing them as JS numbers here is safe and fixes every such query at
// once instead of hunting down each individual cast.
types.setTypeParser(20, (val) => Number.parseInt(val, 10));
types.setTypeParser(1700, (val) => Number.parseFloat(val));

const drizzleLogger: Logger = {
  logQuery(query: string, params: unknown[]) {
    log.debug(query, params.length ? params : "");
  },
};

export class DatabaseRestoreInProgressError extends Error {
  constructor(message = "Database is temporarily unavailable during restore") {
    super(message);
    this.name = "DatabaseRestoreInProgressError";
  }
}

// Lazy-init singleton via globalThis — same reasoning as the old bun:sqlite
// client: avoids duplicate pools across HMR/module re-evaluation.
const globalForDb = globalThis as unknown as {
  _db: ReturnType<typeof drizzle> | undefined;
  _pool: Pool | undefined;
  _accessBlocked: boolean | undefined;
};

const dbAccessBypass = new AsyncLocalStorage<boolean>();

function assertDatabaseAccessible() {
  if (globalForDb._accessBlocked && !dbAccessBypass.getStore()) {
    throw new DatabaseRestoreInProgressError();
  }
}

// 08.10: kept from the bun:sqlite client's own slow-query instrumentation
// (see the Patoune TV migration notes) - genuinely useful for catching a
// bad query/missing index, not just a Bun-specific workaround. Postgres
// itself is async and multi-connection (a slow query here blocks only its
// own caller, never the whole process the way bun:sqlite did), so this is
// now a pure diagnostics aid, not a correctness fix.
const SLOW_QUERY_THRESHOLD_MS = 150;

function getPool(): Pool {
  assertDatabaseAccessible();
  if (!globalForDb._pool) {
    globalForDb._pool = new Pool({ connectionString: DATABASE_URL });
    const rawQuery = globalForDb._pool.query.bind(globalForDb._pool);
    (globalForDb._pool as any).query = (...args: unknown[]) => {
      const start = performance.now();
      const text = typeof args[0] === "string" ? args[0] : ((args[0] as any)?.text ?? "");
      const result = (rawQuery as any)(...args);
      if (result && typeof result.then === "function") {
        return result.finally(() => {
          const duration = performance.now() - start;
          if (duration >= SLOW_QUERY_THRESHOLD_MS) {
            log.warn(`[SLOW_QUERY] ${duration.toFixed(1)}ms: ${String(text).slice(0, 300)}`);
          }
        });
      }
      return result;
    };
  }
  return globalForDb._pool;
}

function getDb() {
  assertDatabaseAccessible();
  if (!globalForDb._db) {
    globalForDb._db = drizzle({
      client: getPool(),
      schema,
      logger: drizzleLogger,
    });
  }
  return globalForDb._db;
}

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_, prop) {
    assertDatabaseAccessible();
    return Reflect.get(getDb(), prop);
  },
});

/** Refresh the query planner's statistics. Postgres owns its own WAL/
 * vacuum/checkpoint housekeeping (autovacuum) - no manual WAL management
 * needed here, unlike the old bun:sqlite client. */
export async function optimizeDatabase() {
  await getPool().query("ANALYZE");
}

export function isDatabaseAccessBlocked(): boolean {
  return globalForDb._accessBlocked === true;
}

export async function withDatabaseAccessBlocked<T>(fn: () => Promise<T> | T): Promise<T> {
  globalForDb._accessBlocked = true;
  try {
    return await dbAccessBypass.run(true, fn);
  } finally {
    globalForDb._accessBlocked = false;
  }
}

/** Close the current connection pool, and clear singletons so the Proxy
 * re-initializes on next access. */
export async function closeDatabase() {
  await globalForDb._pool?.end();
  globalForDb._pool = undefined;
  globalForDb._db = undefined;
}

// ─── Backup / restore ───────────────────────────────────────────────
//
// 14.10, Sid ("backup system needs a pg_dump/pg_restore-based rewrite"):
// SQLite's file-based backup (VACUUM INTO + raw magic-byte/PRAGMA checks)
// had no Postgres equivalent - real subprocess calls to pg_dump/
// pg_restore now, same Bun.spawn + pipe-stdio pattern already used for
// embyFetchViaCurl (packages/core/src/emby.ts). --format=custom (not
// plain SQL): compressed, and the one format pg_restore --list can
// actually validate without applying it.

const REQUIRED_TABLES = Object.values(schema)
  .filter((v) => v instanceof PgTable)
  .map((t) => getTableName(t as PgTable));

async function runPgTool(
  bin: "pg_dump" | "pg_restore",
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn([bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`${bin} failed (exit ${exitCode}): ${stderr.trim() || "no output"}`);
  }
  return { stdout, stderr };
}

/** Dumps the live database to `into` in pg_dump's custom format. */
export async function createPgDump(into: string): Promise<void> {
  await runPgTool("pg_dump", [
    "--format=custom",
    "--no-owner",
    "--no-privileges",
    "--file",
    into,
    DATABASE_URL,
  ]);
}

/** Sanity-checks a dump file without applying it: must be a well-formed
 * custom-format archive (pg_restore --list fails outright on garbage)
 * and must actually contain data for roughly this schema's tables, not
 * e.g. an empty or unrelated database's dump. */
export async function validatePgDump(filePath: string): Promise<void> {
  const { stdout } = await runPgTool("pg_restore", ["--list", filePath]);
  const tableDataCount = REQUIRED_TABLES.filter((t) =>
    stdout.includes(`TABLE DATA public ${t} `),
  ).length;
  // Tolerant, not exact: a backup from a slightly older schema version is
  // still a legitimate restore target (runMigrations() catches it up
  // afterwards) and may be missing a table or two added since.
  if (tableDataCount < REQUIRED_TABLES.length * 0.7) {
    throw new Error(
      `Backup file doesn't look like a ${REQUIRED_TABLES.length}-table Patoune TV dump (found ${tableDataCount} matching tables)`,
    );
  }
}

/** Replaces the live database's contents with what's in `filePath`.
 * --clean --if-exists: drops existing objects first so the restore is a
 * full replacement, not a merge - matches what "restore a backup" means
 * to someone clicking the button, and avoids unique-constraint failures
 * restoring over data that still exists. */
export async function restorePgDump(filePath: string): Promise<void> {
  await runPgTool("pg_restore", [
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    "--dbname",
    DATABASE_URL,
    filePath,
  ]);
}
