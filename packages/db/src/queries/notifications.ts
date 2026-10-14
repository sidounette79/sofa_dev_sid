import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "../client";
import { episodes, seasons, titles, userTitleStatus } from "../schema";

// Episodes airing on `today` (server-local date, "YYYY-MM-DD") that haven't
// had a "new episode" push notification sent yet — notifyNewEpisodes cron,
// packages/core/src/cron.ts.
export function getUnnotifiedEpisodesAiringOn(today: string) {
  return db
    .select({
      episodeId: episodes.id,
      titleId: titles.id,
      titleName: titles.title,
      posterPath: titles.posterPath,
      seasonNumber: seasons.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      episodeName: episodes.name,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(titles, and(eq(seasons.titleId, titles.id), eq(titles.type, "tv")))
    .where(and(eq(episodes.airDate, today), isNull(episodes.notifiedAt)))
    ;
}

export async function markEpisodeNotified(episodeId: string): Promise<void> {
  await db.update(episodes).set({ notifiedAt: new Date() }).where(eq(episodes.id, episodeId));
}

// Users actively following a title (watching or on their watchlist) — the
// audience for both episode-release and status-change notifications.
// Deliberately excludes "completed"/"dropped": a show she's already
// finished isn't one she wants paged about.
export async function getFollowingUserIds(titleId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: userTitleStatus.userId })
    .from(userTitleStatus)
    .where(
      and(
        eq(userTitleStatus.titleId, titleId),
        inArray(userTitleStatus.status, ["watchlist", "in_progress"]),
      ),
    );
  return rows.map((r) => r.userId);
}
