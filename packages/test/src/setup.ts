import { afterEach, beforeAll, vi } from "vitest";

import { applyMigrations, clearAllTables, testDb } from "./db";

process.env.LOG_LEVEL ??= "error";

vi.mock("@sofa/db/client", () => ({
  db: testDb,
  optimizeDatabase: async () => {},
  vacuumDatabase: () => {
    throw new Error("vacuumDatabase() is not implemented for Postgres");
  },
  validateBackupDatabase: () => {
    throw new Error("validateBackupDatabase() is not implemented for Postgres");
  },
  closeDatabase: async () => {},
  isDatabaseAccessBlocked: () => false,
  withDatabaseAccessBlocked: async (fn: () => Promise<unknown> | unknown) => await fn(),
}));

// 08.10, Patoune TV / Postgres migration: migrations only need applying
// once per test run (unlike the old :memory: SQLite db, this database
// persists across test files within the same run) — beforeAll instead of
// top-level await so every test FILE's own setup still waits for it before
// running, and a stale `patounetv_test` database from a previous run gets
// its schema re-applied idempotently rather than silently reused.
beforeAll(async () => {
  await applyMigrations();
  await clearAllTables();
});

afterEach(() => {
  vi.restoreAllMocks();
});
