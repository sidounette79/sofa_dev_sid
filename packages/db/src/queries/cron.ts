import { and, eq, gte, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";

import { db } from "../client";
import {
  cronRuns,
  episodes,
  persons,
  seasons,
  titleAvailability,
  titleCast,
  titleRecommendations,
  titles,
  userTitleStatus,
} from "../schema";

export async function insertCronRunReturning(jobName: string) {
  const [row] = await db
    .insert(cronRuns)
    .values({ jobName, status: "running", startedAt: new Date() })
    .returning();
  return row;
}

export async function updateCronRunSuccess(id: string, durationMs: number): Promise<void> {
  await db
    .update(cronRuns)
    .set({ status: "success", finishedAt: new Date(), durationMs })
    .where(eq(cronRuns.id, id));
}

export async function updateCronRunError(
  id: string,
  durationMs: number,
  errorMessage: string,
): Promise<void> {
  await db
    .update(cronRuns)
    .set({ status: "error", finishedAt: new Date(), durationMs, errorMessage })
    .where(eq(cronRuns.id, id));
}

export async function getLibraryTitleIds(): Promise<string[]> {
  const rows = await db
    .select({ titleId: userTitleStatus.titleId })
    .from(userTitleStatus)
    .groupBy(userTitleStatus.titleId);
  return rows.map((r) => r.titleId);
}

// 30.09, Sid — found live: cacheImagesJob (cron, twice a day) used to call
// getLibraryTitleIds() despite its own name promising a "backfill" list -
// every title got re-walked (poster/backdrop/season/episode/cast checks)
// on every run even when nothing was missing, ~21 minutes twice a day,
// degrading the whole server for that whole window (bun:sqlite is
// synchronous, so every one of those per-title lookups blocks the single
// JS thread). The actual download/thumbhash steps already skip work
// that's done (see cacheImagesForTitle, syncCastProfileThumbHashes...) -
// the real cost was the sheer number of titles being walked at all. This
// only returns titles that are actually missing something, so a fully
// backfilled library goes back to a near-empty, near-instant run.
export async function getTitleIdsNeedingImageBackfill(): Promise<string[]> {
  const seasonsNeedingArt = db
    .select({ titleId: seasons.titleId })
    .from(seasons)
    .where(and(isNotNull(seasons.posterPath), isNull(seasons.posterThumbHash)));

  const episodesNeedingArt = db
    .select({ titleId: seasons.titleId })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(and(isNotNull(episodes.stillPath), isNull(episodes.stillThumbHash)));

  const castNeedingArt = db
    .select({ titleId: titleCast.titleId })
    .from(titleCast)
    .innerJoin(persons, eq(titleCast.personId, persons.id))
    .where(and(isNotNull(persons.profilePath), isNull(persons.profileThumbHash)));

  // Scoped to the same base set getLibraryTitleIds() always used (titles
  // with a userTitleStatus row - watchlist/in progress/completed/dropped)
  // - titles is the full catalog (72k+ rows, most never tracked by
  // anyone here), not "the library", so this can't just scan titles alone.
  const inLibrary = db.select({ titleId: userTitleStatus.titleId }).from(userTitleStatus);

  const rows = await db
    .select({ id: titles.id })
    .from(titles)
    .where(
      and(
        inArray(titles.id, inLibrary),
        or(
          and(isNotNull(titles.posterPath), isNull(titles.posterThumbHash)),
          and(isNotNull(titles.backdropPath), isNull(titles.backdropThumbHash)),
          inArray(titles.id, seasonsNeedingArt),
          inArray(titles.id, episodesNeedingArt),
          inArray(titles.id, castNeedingArt),
        ),
      ),
    );
  return rows.map((r) => r.id);
}

export function getStaleTitles(titleIds: string[], staleDate: Date) {
  if (titleIds.length === 0) return Promise.resolve([]);
  return db
    .select({ id: titles.id })
    .from(titles)
    .where(and(inArray(titles.id, titleIds), lt(titles.lastFetchedAt, staleDate)));
}

export function getStaleNonLibraryTitles(staleDate: Date, limit: number) {
  return db
    .select({ id: titles.id })
    .from(titles)
    .where(and(isNotNull(titles.lastFetchedAt), lt(titles.lastFetchedAt, staleDate)))
    .limit(limit);
}

export async function getTitlesWithStaleOffers(titleIds: string[]): Promise<Set<string>> {
  if (titleIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ titleId: titleAvailability.titleId })
    .from(titleAvailability)
    .where(inArray(titleAvailability.titleId, titleIds))
    .groupBy(titleAvailability.titleId);
  return new Set(rows.map((r) => r.titleId));
}

export async function getTitlesWithStaleOffersFetchedBefore(
  titleIds: string[],
  staleDate: Date,
): Promise<Set<string>> {
  if (titleIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ titleId: titleAvailability.titleId })
    .from(titleAvailability)
    .where(
      and(
        inArray(titleAvailability.titleId, titleIds),
        lt(titleAvailability.lastFetchedAt, staleDate),
      ),
    )
    .groupBy(titleAvailability.titleId);
  return new Set(rows.map((r) => r.titleId));
}

export function getReturningTvShows() {
  const returningStatuses = ["Returning Series", "In Production"];
  return db
    .select({ id: titles.id, tmdbId: titles.tmdbId })
    .from(titles)
    .where(
      and(
        eq(titles.type, "tv"),
        isNotNull(titles.lastFetchedAt),
        or(...returningStatuses.map((s) => eq(titles.status, s))),
      ),
    );
}

export async function getTitleIdsWithStaleSeasons(
  titleIds: string[],
  staleDate: Date,
): Promise<Set<string>> {
  if (titleIds.length === 0) return new Set<string>();
  const rows = await db
    .select({ titleId: seasons.titleId })
    .from(seasons)
    .where(and(inArray(seasons.titleId, titleIds), lt(seasons.lastFetchedAt, staleDate)))
    .groupBy(seasons.titleId);
  return new Set(rows.map((r) => r.titleId));
}

export function getTitleByIdForCron(titleId: string) {
  return db.select().from(titles).where(eq(titles.id, titleId));
}

export function getCastEntryForTitle(titleId: string) {
  return db.select().from(titleCast).where(eq(titleCast.titleId, titleId)).limit(1);
}

export async function deleteOldCronRuns(beforeDate: Date): Promise<number> {
  const deleted = await db
    .delete(cronRuns)
    .where(lt(cronRuns.startedAt, beforeDate))
    .returning({ id: cronRuns.id });
  return deleted.length;
}

export async function getTitlesWithFreshRecommendations(
  titleIds: string[],
  sinceDate: Date,
): Promise<Set<string>> {
  if (titleIds.length === 0) return new Set();

  const rows = await db
    .select({ titleId: titleRecommendations.titleId })
    .from(titleRecommendations)
    .where(
      and(
        inArray(titleRecommendations.titleId, titleIds),
        // All recs for a title share the same lastFetchedAt, so any row suffices
        gte(titleRecommendations.lastFetchedAt, sinceDate),
      ),
    )
    .groupBy(titleRecommendations.titleId);
  return new Set(rows.map((r) => r.titleId));
}
