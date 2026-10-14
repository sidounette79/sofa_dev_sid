import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../client";
import { episodes, seasons, titles } from "../schema";

export function getTitleById(titleId: string) {
  return db.select().from(titles).where(eq(titles.id, titleId));
}

export function getExistingTitlesByTmdbIds(tmdbIds: number[]) {
  if (tmdbIds.length === 0) return Promise.resolve([]);
  return db.select().from(titles).where(inArray(titles.tmdbId, tmdbIds));
}

export function getExistingTitlesByTvdbIds(tvdbIds: number[]) {
  if (tvdbIds.length === 0) return Promise.resolve([]);
  return db.select().from(titles).where(inArray(titles.tvdbId, tvdbIds));
}

/** Bulk variant of markTitleRequested, for the Radarr/Sonarr reconciliation sync. */
export async function markTitlesRequested(updates: { titleId: string; at: Date }[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const { titleId, at } of updates) {
      await tx
        .update(titles)
        .set({ requestedAt: at, requestedByUserId: null })
        .where(eq(titles.id, titleId));
    }
  });
}

/** Household-wide "requested" flag — see schema.ts's titles.requestedAt doc comment. */
export async function markTitleRequested(
  titleId: string,
  userId: string | null,
  at?: Date,
): Promise<void> {
  await db
    .update(titles)
    .set({ requestedAt: at ?? new Date(), requestedByUserId: userId })
    .where(eq(titles.id, titleId));
}

export function findSeasonByTitleAndNumber(titleId: string, seasonNumber: number) {
  return db
    .select()
    .from(seasons)
    .where(and(eq(seasons.titleId, titleId), eq(seasons.seasonNumber, seasonNumber)));
}

export function findEpisodeBySeasonAndNumber(seasonId: string, episodeNumber: number) {
  return db
    .select()
    .from(episodes)
    .where(and(eq(episodes.seasonId, seasonId), eq(episodes.episodeNumber, episodeNumber)));
}

export async function getTitleCount(): Promise<number> {
  const [result] = await db.select({ count: count() }).from(titles);
  return result?.count ?? 0;
}

/**
 * Requested (via Sofa's Request button or reconciled from Radarr/Sonarr
 * directly, see media-requests.ts) but not yet on Emby — the "Demandé - pas
 * dispo" section (24.08, Sid). Deliberately narrower than "on my watchlist
 * with nothing downloaded" (which she asked to remove — too vague, could be
 * "never" for something never actually requested): this is scoped to a real
 * request having gone out, which at least means Radarr/Sonarr are actively
 * searching for it.
 */
export function getRequestedNotAvailable(type: "movie" | "tv", limit = 20) {
  return db
    .select()
    .from(titles)
    .where(
      and(
        eq(titles.type, type),
        eq(titles.inEmbyLibrary, false),
        sql`${titles.requestedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(titles.requestedAt))
    .limit(limit);
}
