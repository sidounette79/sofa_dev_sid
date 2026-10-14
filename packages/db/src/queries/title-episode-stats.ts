import { sql } from "drizzle-orm";

import { db } from "../client";
import { titleEpisodeStats, user } from "../schema";

/**
 * Recompute titleEpisodeStats for every user. See
 * packages/core/src/title-episode-stats.ts for why this is precomputed on
 * an interval rather than derived live on every library request.
 *
 * 08.10, Postgres migration: this used to run on a dedicated Bun Worker
 * thread with its own raw bun:sqlite connection, specifically to avoid
 * blocking the single-threaded, synchronous SQLite main thread - see
 * project_patoune_tv_rebuild memory. Postgres is natively concurrent (this
 * query runs on its own pool connection, never blocking other requests),
 * so a plain scheduled async function is enough now - no separate thread,
 * no duplicated connection/pragma setup to keep in sync with client.ts.
 */
export async function refreshTitleEpisodeStats(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const users = await db.select({ id: user.id }).from(user);

  for (const { id: userId } of users) {
    await db.transaction(async (tx) => {
      const rows = await tx.execute<{
        titleId: string;
        airedCount: number;
        watchedCount: number;
      }>(sql`
        SELECT
          s."titleId" AS "titleId",
          count(distinct case when e."airDate" is not null and e."airDate" <= ${today} then e.id end) as "airedCount",
          count(distinct case when e."airDate" is not null and e."airDate" <= ${today} and uew.id is not null then e.id end) as "watchedCount"
        FROM "seasons" s
        INNER JOIN "episodes" e ON e."seasonId" = s.id
        LEFT JOIN "userEpisodeWatches" uew ON uew."episodeId" = e.id AND uew."userId" = ${userId}
        GROUP BY s."titleId"
      `);

      await tx.delete(titleEpisodeStats).where(sql`${titleEpisodeStats.userId} = ${userId}`);

      if (rows.rows.length > 0) {
        const now = new Date();
        await tx.insert(titleEpisodeStats).values(
          rows.rows.map((row) => ({
            userId,
            titleId: row.titleId,
            airedCount: Number(row.airedCount),
            watchedCount: Number(row.watchedCount),
            updatedAt: now,
          })),
        );
      }
    });
  }
}
