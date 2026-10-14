import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["@sofa/test/setup"],
    // 08.10, Patoune TV / Postgres migration: all test files now share one
    // real Postgres database (no more per-file :memory: SQLite isolation),
    // and each file's beforeEach does a TRUNCATE CASCADE — running files in
    // parallel lets one file's truncate wipe rows a concurrently-running
    // file's test still needs. Confirmed live: cache.test.ts + cron.test.ts
    // together produced spurious failures that vanished when run alone.
    fileParallelism: false,
    // Real network round trips to Postgres per test (vs SQLite's in-process
    // :memory: calls) push some tests close to the 5000ms default on their
    // own, and a full 352-test run adds enough cumulative load to tip one
    // over occasionally — confirmed: the only full-suite failure seen was a
    // single timeout on a test that passes reliably in isolation.
    testTimeout: 15000,
  },
});
