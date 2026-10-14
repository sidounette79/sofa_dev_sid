import { count, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../client";
import { cronRuns, user } from "../schema";

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

/** 14.10, Sid ("Paramètres met toujours plus d'une dizaine de secondes
 * à s'ouvrir"): titles/episodes exact COUNT(*) was a real contributor -
 * Postgres has no index-only shortcut for an exact count (unlike a
 * SQLite rowid table), so this was a full sequential scan over both
 * tables (89k/164k rows) on every single Paramètres page load. reltuples
 * (pg_class, refreshed by autovacuum/ANALYZE) is a catalog lookup, not a
 * scan - an admin dashboard's row-count display doesn't need to be
 * exact to the row, just roughly right. user stays an exact count (tiny
 * table, and an admin page's own user count is worth getting precisely
 * right). */
export async function getTableCounts() {
  const [approx, [userCount]] = await Promise.all([
    db.execute<{ relname: string; estimate: string }>(
      sql`SELECT relname, reltuples::bigint AS estimate FROM pg_class WHERE relname IN ('titles', 'episodes')`,
    ),
    db.select({ count: count() }).from(user),
  ]);
  const byName = new Map(approx.rows.map((r) => [r.relname, Number(r.estimate)]));
  return {
    titleCount: Math.max(0, byName.get("titles") ?? 0),
    episodeCount: Math.max(0, byName.get("episodes") ?? 0),
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
