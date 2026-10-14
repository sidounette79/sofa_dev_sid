import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "../client";
import { deriveEmbyStatus } from "./emby-library";
import {
  episodes,
  seasons,
  titles,
  userEpisodeWatches,
  userMovieWatches,
  userRatings,
  userTitleStatus,
} from "../schema";

/** 31.08, Sid — Emby watch-status reconciliation safety net: embyItemId ->
 * titleId for movies only (TV watch state is tracked per-episode, not on
 * the title row). */
export async function getMovieTitleIdsByEmbyItemId(): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: titles.id, embyItemId: titles.embyItemId })
    .from(titles)
    .where(and(eq(titles.type, "movie"), isNotNull(titles.embyItemId)));
  return new Map(rows.map((r) => [r.embyItemId as string, r.id]));
}

/** Same idea, per-episode — also carries titleId, needed to look up the
 * *current* rewatch cycle for that title per user (01.09 fix, see
 * getWatchedEpisodeCycleKeysForUser below for why this matters). */
export async function getEpisodesByEmbyItemId(): Promise<
  Map<string, { episodeId: string; titleId: string }>
> {
  const rows = await db
    .select({ id: episodes.id, embyItemId: episodes.embyItemId, titleId: seasons.titleId })
    .from(episodes)
    .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
    .where(isNotNull(episodes.embyItemId));
  return new Map(
    rows.map((r) => [r.embyItemId as string, { episodeId: r.id, titleId: r.titleId }]),
  );
}

/** Every titleId this user has ever logged a movie watch for, regardless of
 * how many times — reconciliation only cares whether at least one exists,
 * not the count (a real rewatch is still logged the normal way through the
 * "Watch Again"/webhook path once the gap is caught up). */
export async function getWatchedMovieTitleIdsForUser(userId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ titleId: userMovieWatches.titleId })
    .from(userMovieWatches)
    .where(eq(userMovieWatches.userId, userId));
  return new Set(rows.map((r) => r.titleId));
}

/** 01.09 fix — the original version of this checked "watched at least once
 * ever, any cycle", which silently defeated reconciliation for anyone
 * mid-rewatch: real case found (Sid, "Faites entrer l'accusé" S04E09,
 * currently on cycle 2) — a leftover cycle-1 watch (from a years-old
 * Trakt/Simkl import) made every reconciliation run since think the
 * episode was already accounted for, even though cycle 2 had genuinely
 * never been logged. Keyed as "episodeId:cycle" so the caller can check
 * "watched in *this specific* cycle", matching how every other cycle-aware
 * query in this file already works (getEpisodeProgressByTitleIds, the
 * 31.08 display-status fix). */
export async function getWatchedEpisodeCycleKeysForUser(userId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ episodeId: userEpisodeWatches.episodeId, cycle: userEpisodeWatches.cycle })
    .from(userEpisodeWatches)
    .where(eq(userEpisodeWatches.userId, userId));
  return new Set(rows.map((r) => `${r.episodeId}:${r.cycle}`));
}

export async function upsertTitleStatus(
  userId: string,
  titleId: string,
  // 08.10: "dropped" was missing from this signature even though the
  // schema's own status enum includes it (pre-existing, not a migration
  // regression) - setTitleStatus (packages/core/src/tracking.ts) already
  // accepts "dropped" and was silently relying on no strict check catching
  // the mismatch until this Postgres migration's type-check pass did.
  status: "watchlist" | "in_progress" | "completed" | "dropped",
  addedAt?: Date,
): Promise<void> {
  const now = addedAt ?? new Date();
  await db
    .insert(userTitleStatus)
    .values({ userId, titleId, status, addedAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [userTitleStatus.userId, userTitleStatus.titleId],
      set: { status, updatedAt: now },
    });
}

export async function deleteTitleStatus(userId: string, titleId: string): Promise<void> {
  await db
    .delete(userTitleStatus)
    .where(and(eq(userTitleStatus.userId, userId), eq(userTitleStatus.titleId, titleId)));
}

export async function insertMovieWatch(
  userId: string,
  titleId: string,
  watchedAt: Date,
  source: "manual" | "import" | "jellyfin" | "emby",
): Promise<void> {
  await db.insert(userMovieWatches).values({ userId, titleId, watchedAt, source });
}

export async function insertEpisodeWatch(
  userId: string,
  episodeId: string,
  watchedAt: Date,
  source: "manual" | "import" | "jellyfin" | "emby",
  cycle: number,
): Promise<void> {
  await db.insert(userEpisodeWatches).values({ userId, episodeId, watchedAt, source, cycle });
}

/** Current rewatch cycle for a TV title (1 = never rewatched). Defaults to 1
 * when the title has no stored status yet. */
export async function getTitleCycle(userId: string, titleId: string): Promise<number> {
  const [row] = await db
    .select({ currentCycle: userTitleStatus.currentCycle })
    .from(userTitleStatus)
    .where(and(eq(userTitleStatus.userId, userId), eq(userTitleStatus.titleId, titleId)));
  return row?.currentCycle ?? 1;
}

/** Bumps the rewatch cycle for a TV title and puts it back in progress, so it
 * reappears in "To Watch" as if freshly started — past cycles' episode
 * watches stay in userEpisodeWatches (tagged with their own cycle number)
 * instead of being deleted. */
export async function incrementTitleCycle(userId: string, titleId: string): Promise<number> {
  const now = new Date();
  const [existing] = await getTitleStatus(userId, titleId);
  const nextCycle = (existing?.currentCycle ?? 1) + 1;
  await db
    .insert(userTitleStatus)
    .values({
      userId,
      titleId,
      status: "in_progress",
      addedAt: now,
      updatedAt: now,
      currentCycle: nextCycle,
    })
    .onConflictDoUpdate({
      target: [userTitleStatus.userId, userTitleStatus.titleId],
      set: { status: "in_progress", updatedAt: now, currentCycle: nextCycle },
    });
  return nextCycle;
}

export async function resetTitleCycle(userId: string, titleId: string): Promise<void> {
  await db
    .update(userTitleStatus)
    .set({ currentCycle: 1 })
    .where(and(eq(userTitleStatus.userId, userId), eq(userTitleStatus.titleId, titleId)));
}

/** Batched version of getTitleCycle, for the display-status derivation
 * (31.08, Sid rewatch badge fix) — titles with no stored status default to
 * cycle 1 (never rewatched), matching getTitleCycle's own single-title
 * default, so callers can safely do `.get(titleId) ?? 1`. */
export async function getTitleCyclesByTitleIds(
  userId: string,
  titleIds: string[],
): Promise<Map<string, number>> {
  if (titleIds.length === 0) return new Map();
  const rows = await db
    .select({ titleId: userTitleStatus.titleId, currentCycle: userTitleStatus.currentCycle })
    .from(userTitleStatus)
    .where(and(eq(userTitleStatus.userId, userId), inArray(userTitleStatus.titleId, titleIds)));
  return new Map(rows.map((r) => [r.titleId, r.currentCycle]));
}

/** TV equivalent of getMovieWatchCountsByTitleIds — total watch-throughs
 * (currentCycle, same "1 = watched once, 2 = watched twice" meaning as the
 * movie count), keyed by titleId. Titles never rewatched (cycle 1) are
 * omitted since the caller already defaults missing entries to 0 and the
 * "+N" badge only renders above 1 either way. */
export async function getTvRewatchCountsByTitleIds(
  userId: string,
  titleIds: string[],
): Promise<Map<string, number>> {
  if (titleIds.length === 0) return new Map();
  const rows = await db
    .select({ titleId: userTitleStatus.titleId, currentCycle: userTitleStatus.currentCycle })
    .from(userTitleStatus)
    .where(
      and(
        eq(userTitleStatus.userId, userId),
        inArray(userTitleStatus.titleId, titleIds),
        sql`${userTitleStatus.currentCycle} > 1`,
      ),
    );
  return new Map(rows.map((r) => [r.titleId, r.currentCycle]));
}

export function getTitleStatus(userId: string, titleId: string) {
  return db
    .select()
    .from(userTitleStatus)
    .where(and(eq(userTitleStatus.userId, userId), eq(userTitleStatus.titleId, titleId)));
}

export async function getEpisodeTitleId(episodeId: string): Promise<string | null> {
  const [row] = await db
    .select({ titleId: seasons.titleId })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(eq(episodes.id, episodeId));
  return row?.titleId ?? null;
}

export async function getEpisodeTitleIds(episodeIds: string[]): Promise<Map<string, string>> {
  if (episodeIds.length === 0) return new Map();
  const rows = await db
    .select({ episodeId: episodes.id, titleId: seasons.titleId })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(inArray(episodes.id, episodeIds));
  return new Map(rows.map((r) => [r.episodeId, r.titleId]));
}

export async function batchInsertEpisodeWatchesTransaction(
  userId: string,
  episodeIds: string[],
  source: "manual" | "import" | "jellyfin" | "emby",
  watchedAt?: Date,
): Promise<{ titleId: string | null }> {
  if (episodeIds.length === 0) return { titleId: null };

  return db.transaction(async (tx) => {
    const now = watchedAt ?? new Date();

    const eps = await tx.select().from(episodes).where(inArray(episodes.id, episodeIds));
    if (eps.length === 0) return { titleId: null };

    const seasonIds = [...new Set(eps.map((e) => e.seasonId))];
    const seasonRows = await tx.select().from(seasons).where(inArray(seasons.id, seasonIds));
    if (seasonRows.length === 0) return { titleId: null };

    const { titleId } = seasonRows[0]!;

    const [existing] = await tx
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, userId), eq(userTitleStatus.titleId, titleId)));
    const cycle = existing?.currentCycle ?? 1;

    await tx
      .insert(userEpisodeWatches)
      .values(episodeIds.map((episodeId) => ({ userId, episodeId, watchedAt: now, source, cycle })));

    if (!existing || existing.status === "watchlist") {
      const statusNow = new Date();
      await tx
        .insert(userTitleStatus)
        .values({
          userId,
          titleId,
          status: "in_progress",
          addedAt: statusNow,
          updatedAt: statusNow,
        })
        .onConflictDoUpdate({
          target: [userTitleStatus.userId, userTitleStatus.titleId],
          set: { status: "in_progress", updatedAt: statusNow },
        });
    }

    return { titleId };
  });
}

export async function getAllEpisodeIdsForTitle(titleId: string): Promise<string[]> {
  const rows = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(eq(seasons.titleId, titleId));
  return rows.map((ep) => ep.id);
}

export async function getExistingEpisodeWatchIds(
  userId: string,
  episodeIds: string[],
  cycle: number,
): Promise<Set<string>> {
  if (episodeIds.length === 0) return new Set();
  const rows = await db
    .select({ episodeId: userEpisodeWatches.episodeId })
    .from(userEpisodeWatches)
    .where(
      and(
        eq(userEpisodeWatches.userId, userId),
        inArray(userEpisodeWatches.episodeId, episodeIds),
        eq(userEpisodeWatches.cycle, cycle),
      ),
    );
  return new Set(rows.map((w) => w.episodeId));
}

export async function batchInsertMissingEpisodeWatches(
  userId: string,
  episodeIds: string[],
  existingWatches: Set<string>,
  source: "manual" | "import" | "jellyfin" | "emby",
  watchedAt: Date,
  cycle: number,
): Promise<void> {
  const toInsert = episodeIds.filter((episodeId) => !existingWatches.has(episodeId));
  if (toInsert.length === 0) return;
  await db
    .insert(userEpisodeWatches)
    .values(toInsert.map((episodeId) => ({ userId, episodeId, watchedAt, source, cycle })));
}

export async function countDistinctEpisodeWatches(
  userId: string,
  episodeIds: string[],
  cycle: number,
): Promise<number> {
  if (episodeIds.length === 0) return 0;
  const [result] = await db
    .select({
      count: sql<number>`count(distinct ${userEpisodeWatches.episodeId})`,
    })
    .from(userEpisodeWatches)
    .where(
      and(
        eq(userEpisodeWatches.userId, userId),
        inArray(userEpisodeWatches.episodeId, episodeIds),
        eq(userEpisodeWatches.cycle, cycle),
      ),
    );
  return result?.count ?? 0;
}

export async function upsertRating(
  userId: string,
  titleId: string,
  ratingStars: number,
  ratedAt: Date,
): Promise<void> {
  await db
    .insert(userRatings)
    .values({ userId, titleId, ratingStars, ratedAt })
    .onConflictDoUpdate({
      target: [userRatings.userId, userRatings.titleId],
      set: { ratingStars, ratedAt },
    });
}

export async function deleteRating(userId: string, titleId: string): Promise<void> {
  await db.delete(userRatings).where(and(eq(userRatings.userId, userId), eq(userRatings.titleId, titleId)));
}

export function getUserStatusesByTitleIds(userId: string, titleIds: string[]) {
  if (titleIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      titleId: userTitleStatus.titleId,
      status: userTitleStatus.status,
    })
    .from(userTitleStatus)
    .where(and(eq(userTitleStatus.userId, userId), inArray(userTitleStatus.titleId, titleIds)));
}

/** 28.09, Jellyseerr-compat discover/watchlist — full title rows for
 * everything a user has marked "watchlist", newest-first. */
export function getTitlesByUserStatus(
  userId: string,
  status: "watchlist" | "in_progress" | "completed" | "dropped",
) {
  return db
    .select({
      id: titles.id,
      tmdbId: titles.tmdbId,
      type: titles.type,
      title: titles.title,
      posterPath: titles.posterPath,
      overview: titles.overview,
      releaseDate: titles.releaseDate,
      firstAirDate: titles.firstAirDate,
      voteAverage: titles.voteAverage,
    })
    .from(userTitleStatus)
    .innerJoin(titles, eq(titles.id, userTitleStatus.titleId))
    .where(and(eq(userTitleStatus.userId, userId), eq(userTitleStatus.status, status)))
    .orderBy(sql`${userTitleStatus.updatedAt} desc`);
}

export function getEpisodeProgressByTitleIds(userId: string, titleIds: string[]) {
  if (titleIds.length === 0) return Promise.resolve([]);
  const today = new Date().toISOString().slice(0, 10);
  return db
    .select({
      titleId: titles.id,
      totalEpisodes:
        sql<number>`count(distinct case when ${episodes.airDate} IS NOT NULL AND ${episodes.airDate} <= ${today} then ${episodes.id} end)`.as(
          "totalEpisodes",
        ),
      watchedEpisodes:
        sql<number>`count(distinct case when ${userEpisodeWatches.id} is not null AND ${episodes.airDate} IS NOT NULL AND ${episodes.airDate} <= ${today} then ${episodes.id} end)`.as(
          "watchedEpisodes",
        ),
    })
    .from(titles)
    .innerJoin(seasons, eq(seasons.titleId, titles.id))
    .innerJoin(episodes, eq(episodes.seasonId, seasons.id))
    .leftJoin(
      userTitleStatus,
      and(eq(userTitleStatus.titleId, titles.id), eq(userTitleStatus.userId, userId)),
    )
    .leftJoin(
      userEpisodeWatches,
      and(
        eq(userEpisodeWatches.episodeId, episodes.id),
        eq(userEpisodeWatches.userId, userId),
        // Only count watches from the title's current rewatch cycle — a
        // rewatch in progress shouldn't look "already finished" because of
        // watches left over from a previous cycle.
        eq(userEpisodeWatches.cycle, sql`coalesce(${userTitleStatus.currentCycle}, 1)`),
      ),
    )
    .where(and(inArray(titles.id, titleIds), eq(titles.type, "tv")))
    .groupBy(titles.id);
}

export async function getUserTitleInfo(userId: string, titleId: string) {
  const [info] = await db
    .select({
      status: userTitleStatus.status,
      ratingStars: userRatings.ratingStars,
      currentCycle: userTitleStatus.currentCycle,
    })
    .from(userTitleStatus)
    .leftJoin(
      userRatings,
      and(
        eq(userRatings.userId, userTitleStatus.userId),
        eq(userRatings.titleId, userTitleStatus.titleId),
      ),
    )
    .where(and(eq(userTitleStatus.userId, userId), eq(userTitleStatus.titleId, titleId)));

  // Household-wide, not scoped to this user's row — see schema.ts's
  // titles.requestedAt doc comment (deliberately separate query: a title can
  // be requested with no userTitleStatus row for THIS user at all, e.g.
  // requested by someone else in the house).
  // 25.08, Sid — real bug found live (logged in as Mary): a title already
  // available under someone else's Emby folder still let her open a
  // duplicate request from the detail page, since this endpoint never told
  // the frontend whether it was already available. Same fields the library
  // feed already derives embyStatus from (title-level, not per-user).
  const [requested] = await db
    .select({
      requestedAt: titles.requestedAt,
      inEmbyLibrary: titles.inEmbyLibrary,
      embyItemId: titles.embyItemId,
    })
    .from(titles)
    .where(eq(titles.id, titleId));

  const cycle = info?.currentCycle ?? 1;

  const watchedEpisodeRows = await db
    .selectDistinct({ episodeId: userEpisodeWatches.episodeId })
    .from(userEpisodeWatches)
    .innerJoin(episodes, eq(userEpisodeWatches.episodeId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(
      and(
        eq(userEpisodeWatches.userId, userId),
        eq(seasons.titleId, titleId),
        eq(userEpisodeWatches.cycle, cycle),
      ),
    );
  const watchedEpisodeIds = watchedEpisodeRows.map((w) => w.episodeId);

  // Episodes with a watch in 2+ distinct cycles — drives the "watched
  // again" tint on the episode checkbox, independent of the current cycle.
  const rewatchedRows = await db
    .select({ episodeId: userEpisodeWatches.episodeId })
    .from(userEpisodeWatches)
    .innerJoin(episodes, eq(userEpisodeWatches.episodeId, episodes.id))
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(and(eq(userEpisodeWatches.userId, userId), eq(seasons.titleId, titleId)))
    .groupBy(userEpisodeWatches.episodeId)
    .having(sql`count(distinct ${userEpisodeWatches.cycle}) > 1`);
  const rewatchedEpisodeIds = rewatchedRows.map((w) => w.episodeId);

  return {
    status: info?.status ?? null,
    rating: info?.ratingStars ?? null,
    episodeWatches: watchedEpisodeIds,
    rewatchedEpisodeIds,
    requestedAt: requested?.requestedAt ?? null,
    embyStatus: deriveEmbyStatus(requested?.inEmbyLibrary ?? false, requested?.embyItemId ?? null),
  };
}

export function getSeasonEpisodes(seasonId: string) {
  return db.select().from(episodes).where(eq(episodes.seasonId, seasonId));
}

export async function getSeasonEpisodeIds(seasonId: string): Promise<string[]> {
  const rows = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.seasonId, seasonId));
  return rows.map((e) => e.id);
}

export function getSeasonById(seasonId: string) {
  return db.select().from(seasons).where(eq(seasons.id, seasonId));
}

export async function deleteEpisodeWatches(
  userId: string,
  episodeIds: string[],
  cycle: number,
): Promise<void> {
  if (episodeIds.length === 0) return;
  await db
    .delete(userEpisodeWatches)
    .where(
      and(
        eq(userEpisodeWatches.userId, userId),
        inArray(userEpisodeWatches.episodeId, episodeIds),
        eq(userEpisodeWatches.cycle, cycle),
      ),
    );
}

export async function deleteEpisodeWatch(
  userId: string,
  episodeId: string,
  cycle: number,
): Promise<void> {
  await db
    .delete(userEpisodeWatches)
    .where(
      and(
        eq(userEpisodeWatches.userId, userId),
        eq(userEpisodeWatches.episodeId, episodeId),
        eq(userEpisodeWatches.cycle, cycle),
      ),
    );
}

export async function deleteMovieWatches(userId: string, titleId: string): Promise<void> {
  await db
    .delete(userMovieWatches)
    .where(and(eq(userMovieWatches.userId, userId), eq(userMovieWatches.titleId, titleId)));
}

/** Wipes watch history for a title across *all* rewatch cycles — used when
 * the user removes the title from tracking entirely, not for a normal
 * unwatch. Callers should also reset currentCycle back to 1. */
export async function deleteAllEpisodeWatchesForTitle(
  userId: string,
  titleId: string,
): Promise<void> {
  const titleEpisodeRows = await db
    .select({ id: episodes.id })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(eq(seasons.titleId, titleId));
  const titleEpisodeIds = titleEpisodeRows.map((r) => r.id);

  if (titleEpisodeIds.length === 0) return;
  await db
    .delete(userEpisodeWatches)
    .where(
      and(
        eq(userEpisodeWatches.userId, userId),
        inArray(userEpisodeWatches.episodeId, titleEpisodeIds),
      ),
    );
}
