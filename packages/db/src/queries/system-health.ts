import { count, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../client";
import { cronRuns, episodes, titles, user } from "../schema";

/** 08.10, Postgres migration: replaces Bun.file(DATABASE_URL).size, which
 * only worked because SQLite is a plain file - DATABASE_URL is now a
 * connection string, not a path. No real WAL-file-size equivalent exists
 * at this permission level (that's superuser-only pg_stat info), so the
 * caller just shows 0 for that field now - see system-health.ts's comment. */
export async function getDatabaseSizeBytes(): Promise<number> {
  // node-postgres's db.execute() returns the raw pg QueryResult ({ rows })
  // rather than the rows array directly (unlike e.g. the postgres-js driver).
  const result = await db.execute<{ size: number }>(
    sql`SELECT pg_database_size(current_database())::bigint AS size`,
  );
  return Number(result.rows[0]?.size ?? 0);
}

export async function getTableCounts() {
  const [[titleCount], [episodeCount], [userCount]] = await Promise.all([
    db.select({ count: count() }).from(titles),
    db.select({ count: count() }).from(episodes),
    db.select({ count: count() }).from(user),
  ]);
  return {
    titleCount: titleCount?.count ?? 0,
    episodeCount: episodeCount?.count ?? 0,
    userCount: userCount?.count ?? 0,
  };
}

export function getLatestCronRun(jobName: string) {
  return db
    .select()
    .from(cronRuns)
    .where(eq(cronRuns.jobName, jobName))
    .orderBy(desc(cronRuns.startedAt))
    .limit(1);
}

export async function getLatestCronRuns(jobNames: string[]) {
  if (jobNames.length === 0) return new Map<string, typeof cronRuns.$inferSelect>();
  const rows = await db
    .select({
      id: cronRuns.id,
      jobName: cronRuns.jobName,
      status: cronRuns.status,
      startedAt: cronRuns.startedAt,
      finishedAt: cronRuns.finishedAt,
      durationMs: cronRuns.durationMs,
      errorMessage: cronRuns.errorMessage,
      rn: sql<number>`row_number() over (partition by ${cronRuns.jobName} order by ${cronRuns.startedAt} desc)`.as(
        "rn",
      ),
    })
    .from(cronRuns)
    .where(inArray(cronRuns.jobName, jobNames));

  const latest = rows.filter((r) => r.rn === 1);
  return new Map(latest.map((r) => [r.jobName, r]));
}
