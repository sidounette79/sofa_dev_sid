import { beforeEach, describe, expect, test } from "vitest";

import { cronRuns } from "@sofa/db/schema";
import { clearAllTables, eq, testDb } from "@sofa/test/db";

import { completeCronRun, failCronRun, startCronRun } from "../src/cron";

beforeEach(async () => {
  await clearAllTables();
});

describe("startCronRun", () => {
  test("inserts a cron run record", async () => {
    const run = await startCronRun("metadata-refresh");
    expect(run.id).toBeDefined();
    expect(run.jobName).toBe("metadata-refresh");

    const [row] = await testDb.select().from(cronRuns).where(eq(cronRuns.id, run.id));
    expect(row).toBeDefined();
    expect(row?.status).toBe("running");
  });
});

describe("completeCronRun", () => {
  test("marks a run as successful with duration", async () => {
    const run = await startCronRun("test-job");
    await completeCronRun(run.id, 1500);

    const [row] = await testDb.select().from(cronRuns).where(eq(cronRuns.id, run.id));
    expect(row?.status).toBe("success");
    expect(row?.durationMs).toBe(1500);
  });
});

describe("failCronRun", () => {
  test("marks a run as failed with error message", async () => {
    const run = await startCronRun("test-job");
    await failCronRun(run.id, 500, new Error("Something broke"));

    const [row] = await testDb.select().from(cronRuns).where(eq(cronRuns.id, run.id));
    expect(row?.status).toBe("error");
    expect(row?.durationMs).toBe(500);
    expect(row?.errorMessage).toBe("Something broke");
  });

  test("handles non-Error objects", async () => {
    const run = await startCronRun("test-job");
    await failCronRun(run.id, 100, "string error");

    const [row] = await testDb.select().from(cronRuns).where(eq(cronRuns.id, run.id));
    expect(row?.errorMessage).toBe("string error");
  });
});
