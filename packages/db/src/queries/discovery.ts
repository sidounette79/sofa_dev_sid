import { and, asc, desc, eq, gte, inArray, lte, ne, notInArray, or, sql } from "drizzle-orm";

import { db } from "../client";
import {
  episodes,
  platforms,
  seasons,
  titleAvailability,
  titleRecommendations,
  titles,
  userEpisodeWatches,
  userMovieWatches,
  userRatings,
  userTitleStatus,
} from "../schema";

// 08.10, Postgres migration: `since` is unix seconds (see
// periodStartTimestamp, packages/core/src/discovery.ts) - watchedAt is now
// a real `timestamp` column, not a raw epoch int, so it needs converting
// to a JS Date for comparison rather than being compared as a bare number.
export async function getMovieWatchCountSince(userId: string, since: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(userMovieWatches)
    .where(and(eq(userMovieWatches.userId, userId), gte(userMovieWatches.watchedAt, new Date(since * 1000))));
  return row?.count ?? 0;
}

export async function getEpisodeWatchCountSince(userId: string, since: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(userEpisodeWatches)
    .where(
      and(eq(userEpisodeWatches.userId, userId), gte(userEpisodeWatches.watchedAt, new Date(since * 1000))),
    );
  return row?.count ?? 0;
}

// 25.08, Sid: an all-time "time spent watching" stat, "histoire de faire
// peur" — each watch row counted separately (a rewatch adds its runtime
// again), weighted by real runtime rather than a flat per-title estimate.
// SQLite's SUM ignores NULLs on its own, so a handful of titles/episodes
// missing runtimeMinutes just don't contribute rather than breaking the sum.
export async function getTotalMovieWatchMinutes(userId: string): Promise<number> {
  const [row] = await db
    .select({ minutes: sql<number>`sum(${titles.runtimeMinutes})` })
    .from(userMovieWatches)
    .innerJoin(titles, eq(titles.id, userMovieWatches.titleId))
    .where(eq(userMovieWatches.userId, userId));
  return row?.minutes ?? 0;
}

export async function getTotalEpisodeWatchMinutes(userId: string): Promise<number> {
  const [row] = await db
    .select({ minutes: sql<number>`sum(${episodes.runtimeMinutes})` })
    .from(userEpisodeWatches)
    .innerJoin(episodes, eq(episodes.id, userEpisodeWatches.episodeId))
    .where(eq(userEpisodeWatches.userId, userId));
  return row?.minutes ?? 0;
}

export async function getMovieWatchCountsByTitleIds(
  userId: string,
  titleIds: string[],
): Promise<Map<string, number>> {
  if (titleIds.length === 0) return new Map();
  const rows = await db
    .select({
      titleId: userMovieWatches.titleId,
      count: sql<number>`count(*)`,
    })
    .from(userMovieWatches)
    .where(
      and(eq(userMovieWatches.userId, userId), inArray(userMovieWatches.titleId, titleIds)),
    )
    .groupBy(userMovieWatches.titleId);
  return new Map(rows.map((r) => [r.titleId, r.count]));
}

// 08.10, Postgres migration: SQLite's strftime() format tokens don't exist
// in Postgres's to_char() - only 3 formats are ever actually passed (see
// packages/core/src/discovery.ts's getWatchHistoryBuckets), so a small
// lookup is simpler and safer than a general token translator.
const SQLITE_TO_PG_FORMAT: Record<string, string> = {
  "%H": "HH24",
  "%Y-%m-%d": "YYYY-MM-DD",
  "%Y-%m": "YYYY-MM",
};

function toPgDateFormat(sqliteFormat: string): string {
  const pgFormat = SQLITE_TO_PG_FORMAT[sqliteFormat];
  if (!pgFormat) {
    throw new Error(`Unknown watch-history bucket format: ${sqliteFormat}`);
  }
  return pgFormat;
}

// watchedAt is a real `timestamp` column (UTC) now, not a unix epoch int -
// AT TIME ZONE converts to the deployment's local time before bucketing,
// matching SQLite's 'localtime' modifier this replaces. Hardcoded rather
// than reading TZ at query time: this deployment's compose.yaml always
// sets Europe/Zurich, same assumption the original 'localtime' depended on.
const LOCAL_TZ = "Europe/Zurich";

export function getMovieWatchHistoryBuckets(userId: string, startTs: number, format: string) {
  const pgFormat = toPgDateFormat(format);
  const since = new Date(startTs * 1000);
  // 08.10, real bug found live (Patoune TV, against migrated data): writing
  // the same to_char(...) expression out twice (once for SELECT, once for
  // GROUP BY) let drizzle render the column reference qualified in one and
  // unqualified in the other - textually different SQL, which Postgres
  // then refuses to recognize as the same GROUP BY key. Grouping by the
  // output alias instead (Postgres allows this) means the expression is
  // only ever written once.
  const bucket =
    sql<string>`to_char(${userMovieWatches.watchedAt} AT TIME ZONE 'UTC' AT TIME ZONE ${LOCAL_TZ}, ${pgFormat})`.as(
      "bucket",
    );
  return db
    .select({
      bucket,
      count: sql<number>`count(*)`.as("cnt"),
    })
    .from(userMovieWatches)
    .where(and(eq(userMovieWatches.userId, userId), gte(userMovieWatches.watchedAt, since)))
    .groupBy(sql`bucket`);
}

export function getEpisodeWatchHistoryBuckets(userId: string, startTs: number, format: string) {
  const pgFormat = toPgDateFormat(format);
  const since = new Date(startTs * 1000);
  const bucket =
    sql<string>`to_char(${userEpisodeWatches.watchedAt} AT TIME ZONE 'UTC' AT TIME ZONE ${LOCAL_TZ}, ${pgFormat})`.as(
      "bucket",
    );
  return db
    .select({
      bucket,
      count: sql<number>`count(*)`.as("cnt"),
    })
    .from(userEpisodeWatches)
    .where(and(eq(userEpisodeWatches.userId, userId), gte(userEpisodeWatches.watchedAt, since)))
    .groupBy(sql`bucket`);
}

export async function getUserStatusCounts(userId: string) {
  const [row] = await db
    .select({
      librarySize: sql<number>`count(*)`,
      movieCompleted: sql<number>`sum(case when ${userTitleStatus.status} = 'completed' then 1 else 0 end)`,
    })
    .from(userTitleStatus)
    .where(eq(userTitleStatus.userId, userId));

  // Count TV shows where all aired episodes are watched (caught_up + completed display states)
  const today = new Date().toISOString().slice(0, 10);
  const [tvRow] = await db
    .select({ count: sql<number>`count(*)` })
    .from(userTitleStatus)
    .innerJoin(titles, eq(titles.id, userTitleStatus.titleId))
    .where(
      and(
        eq(userTitleStatus.userId, userId),
        eq(userTitleStatus.status, "in_progress"),
        eq(titles.type, "tv"),
        sql`(
          SELECT count(distinct e.id) FROM "episodes" e
          INNER JOIN "seasons" s ON e."seasonId" = s.id
          WHERE s."titleId" = ${titles.id} AND e."airDate" IS NOT NULL AND e."airDate" <= ${today}
        ) > 0`,
        sql`(
          SELECT count(distinct e.id) FROM "episodes" e
          INNER JOIN "seasons" s ON e."seasonId" = s.id
          WHERE s."titleId" = ${titles.id} AND e."airDate" IS NOT NULL AND e."airDate" <= ${today}
        ) = (
          SELECT count(distinct ew."episodeId") FROM "userEpisodeWatches" ew
          INNER JOIN "episodes" e2 ON ew."episodeId" = e2.id
          INNER JOIN "seasons" s2 ON e2."seasonId" = s2.id
          WHERE s2."titleId" = ${titles.id} AND ew."userId" = ${userTitleStatus.userId}
            AND e2."airDate" IS NOT NULL AND e2."airDate" <= ${today}
        )`,
      ),
    );

  return {
    librarySize: row?.librarySize ?? 0,
    completed: (row?.movieCompleted ?? 0) + (tvRow?.count ?? 0),
  };
}

// 30.09, Sid — found live: 868 titles sitting "in_progress" for her real,
// years-old library (nothing wrong with that - genuinely started, never
// finished). getContinueWatchingFeed used to fan every single one of
// these out into further batch queries (seasons, owned episodes,
// watches), each multiplying out further - measured live freezing the
// whole server for 15-72s, growing with each concurrent poll (same class
// of problem, same fix shape, as RECOMMENDATION_SOURCE_LIMIT just below
// in discovery.ts). Capped here, at the source, so nothing downstream
// ever sees more than this many rows - the most recently updated ones
// are also the ones actually worth surfacing in "Continuer à regarder"
// anyway, not a quality tradeoff.
const IN_PROGRESS_TITLE_LIMIT = 150;

export function getInProgressTitleIds(userId: string) {
  return db
    .select({
      titleId: userTitleStatus.titleId,
      updatedAt: userTitleStatus.updatedAt,
      currentCycle: userTitleStatus.currentCycle,
    })
    .from(userTitleStatus)
    .where(and(eq(userTitleStatus.userId, userId), eq(userTitleStatus.status, "in_progress")))
    .orderBy(desc(userTitleStatus.updatedAt))
    .limit(IN_PROGRESS_TITLE_LIMIT)
    ;
}

export function getTvTitlesByIds(titleIds: string[]) {
  if (titleIds.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(titles)
    .where(and(inArray(titles.id, titleIds), eq(titles.type, "tv")))
    ;
}

export function getSeasonsByTitleIds(titleIds: string[]) {
  if (titleIds.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(seasons)
    .where(inArray(seasons.titleId, titleIds))
    .orderBy(seasons.titleId, seasons.seasonNumber)
    ;
}

export function getEpisodesBySeasonIds(seasonIds: string[]) {
  if (seasonIds.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(episodes)
    .where(inArray(episodes.seasonId, seasonIds))
    .orderBy(episodes.seasonId, episodes.episodeNumber)
    ;
}

/**
 * Same as getEpisodesBySeasonIds but scoped to episodes actually available
 * on Emby (embyItemId set) — used by getContinueWatchingFeed so a title
 * whose next unwatched episode hasn't been downloaded yet (e.g. awaiting a
 * French release) doesn't clutter the feed, and so the feed doesn't have to
 * load every TMDB-known episode just to find the one that matters.
 */
export function getOwnedEpisodesBySeasonIds(seasonIds: string[]) {
  if (seasonIds.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(episodes)
    .where(and(inArray(episodes.seasonId, seasonIds), sql`${episodes.embyItemId} is not null`))
    .orderBy(episodes.seasonId, episodes.episodeNumber)
    ;
}

export function getEpisodeWatchesByEpisodeIds(userId: string, episodeIds: string[]) {
  if (episodeIds.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(userEpisodeWatches)
    .where(
      and(eq(userEpisodeWatches.userId, userId), inArray(userEpisodeWatches.episodeId, episodeIds)),
    )
    ;
}

export function getNewAvailableFeed(userId: string, _days = 14) {
  return db
    .select({
      titleId: titles.id,
      title: titles.title,
      type: titles.type,
      tmdbId: titles.tmdbId,
      posterPath: titles.posterPath,
      posterThumbHash: titles.posterThumbHash,
      releaseDate: titles.releaseDate,
      firstAirDate: titles.firstAirDate,
      voteAverage: titles.voteAverage,
      popularity: titles.popularity,
      userStatus: userTitleStatus.status,
    })
    .from(titles)
    .innerJoin(
      userTitleStatus,
      and(eq(userTitleStatus.titleId, titles.id), eq(userTitleStatus.userId, userId)),
    )
    .where(
      sql`EXISTS (SELECT 1 FROM ${titleAvailability} WHERE ${titleAvailability.titleId} = ${titles.id})`,
    )
    .orderBy(desc(titles.popularity))
    .limit(20)
    ;
}

export async function getEngagedTitleIds(userId: string, limit?: number): Promise<string[]> {
  let query = db
    .select({ titleId: userTitleStatus.titleId })
    .from(userTitleStatus)
    .where(
      and(
        eq(userTitleStatus.userId, userId),
        sql`${userTitleStatus.status} IN ('completed', 'in_progress')`,
      ),
    )
    .orderBy(desc(userTitleStatus.updatedAt))
    .$dynamic();
  if (limit != null) query = query.limit(limit);
  const rows = await query;
  return rows.map((r) => r.titleId);
}

export async function getHighlyRatedTitleIds(userId: string, limit?: number): Promise<string[]> {
  let query = db
    .select({ titleId: userRatings.titleId })
    .from(userRatings)
    .where(and(eq(userRatings.userId, userId), sql`${userRatings.ratingStars} >= 4`))
    .orderBy(desc(userRatings.ratedAt))
    .$dynamic();
  if (limit != null) query = query.limit(limit);
  const rows = await query;
  return rows.map((r) => r.titleId);
}

export async function getRatingStats(userId: string) {
  const [row] = await db
    .select({
      average: sql<number | null>`avg(${userRatings.ratingStars})`,
      count: sql<number>`count(*)`,
    })
    .from(userRatings)
    .where(eq(userRatings.userId, userId));
  return { average: row?.average ?? null, count: row?.count ?? 0 };
}

export async function getAllTrackedTitleIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ titleId: userTitleStatus.titleId })
    .from(userTitleStatus)
    .where(eq(userTitleStatus.userId, userId));
  return rows.map((r) => r.titleId);
}

// Was: fetch every (titleId IN sourceIds) row (hundreds of thousands for an
// active library, e.g. ~230k for ~2700 source titles) and aggregate scores
// in JS — the row hydration alone cost 0.5-2s per dashboard load. Aggregating
// with GROUP BY/ORDER BY/LIMIT lets SQLite do it in-engine (a few ms), we
// only ever pull the top `limit` rows out.
// `type` filters via a join against `titles` before the GROUP BY/LIMIT, so a
// type-scoped call still only pulls `limit` rows out of SQLite (24.08, Sid:
// found live — the global top-20 cap was skewing 100% movie for her account,
// leaving the Séries page's recommendations empty since the old client-side
// type filter ran after the cap already discarded every TV row).
// 25.08, Sid: recommendations skewing to old/obscure titles — a floor on
// release/air year so the feed sticks to at least the 2000s. Exported so
// getRecommendationsForTitle (packages/core/src/discovery.ts) — the other
// place recommendations show up — applies the exact same floor.
export const RECOMMENDATION_MIN_YEAR = "2000-01-01";

export function getTopRecommendationRows(
  sourceIds: string[],
  excludeIds: string[],
  limit: number,
  type?: "movie" | "tv",
) {
  if (sourceIds.length === 0) return Promise.resolve([]);
  // Now always joined (previously only when `type` was given) — the year
  // floor below needs it regardless.
  return db
    .select({
      recommendedTitleId: titleRecommendations.recommendedTitleId,
      score: sql<number>`sum(100 - ${titleRecommendations.rank})`,
    })
    .from(titleRecommendations)
    .innerJoin(titles, eq(titles.id, titleRecommendations.recommendedTitleId))
    .where(
      and(
        inArray(titleRecommendations.titleId, sourceIds),
        excludeIds.length > 0
          ? notInArray(titleRecommendations.recommendedTitleId, excludeIds)
          : undefined,
        type ? eq(titles.type, type) : undefined,
        // gte() against a NULL releaseDate/firstAirDate evaluates to NULL
        // (excluded) in SQL — titles with no known date just don't show up,
        // rather than needing separate null-handling here.
        or(
          gte(titles.releaseDate, RECOMMENDATION_MIN_YEAR),
          gte(titles.firstAirDate, RECOMMENDATION_MIN_YEAR),
        ),
      ),
    )
    .groupBy(titleRecommendations.recommendedTitleId)
    .orderBy(desc(sql`sum(100 - ${titleRecommendations.rank})`))
    .limit(limit)
    ;
}

export function getTitlesByIds(titleIds: string[]) {
  if (titleIds.length === 0) return Promise.resolve([]);
  return db.select().from(titles).where(inArray(titles.id, titleIds));
}

export async function getEmbyStatusByTitleIds(
  titleIds: string[],
): Promise<Record<string, { inEmbyLibrary: boolean; embyItemId: string | null }>> {
  if (titleIds.length === 0) return {};
  const rows = await db
    .select({ id: titles.id, inEmbyLibrary: titles.inEmbyLibrary, embyItemId: titles.embyItemId })
    .from(titles)
    .where(inArray(titles.id, titleIds));
  const result: Record<string, { inEmbyLibrary: boolean; embyItemId: string | null }> = {};
  for (const row of rows) {
    result[row.id] = { inEmbyLibrary: row.inEmbyLibrary, embyItemId: row.embyItemId };
  }
  return result;
}

// 26.08, Sid — real bug found live: Discover's "already requested" bookmark
// badge only ever came from getDisplayStatusesByTitleIds (context.user.id
// -scoped userTitleStatus), so it showed only for whoever personally
// clicked Request — not household-wide, even though titles.requestedAt
// itself is deliberately global (see schema.ts's own doc comment, and
// title.ts's markTitleRequested). Confirmed live: XA's Discover page showed
// no bookmark on titles Sid had already requested. Mirrors
// getEmbyStatusByTitleIds's shape exactly.
export async function getRequestedAtByTitleIds(titleIds: string[]): Promise<Record<string, Date>> {
  if (titleIds.length === 0) return {};
  const rows = await db
    .select({ id: titles.id, requestedAt: titles.requestedAt })
    .from(titles)
    .where(and(inArray(titles.id, titleIds), sql`${titles.requestedAt} IS NOT NULL`));
  const result: Record<string, Date> = {};
  for (const row of rows) {
    if (row.requestedAt) result[row.id] = row.requestedAt;
  }
  return result;
}

export function getRecommendationRowsForTitle(titleId: string) {
  return db
    .select({
      recommendedTitleId: titleRecommendations.recommendedTitleId,
      source: titleRecommendations.source,
      rank: titleRecommendations.rank,
    })
    .from(titleRecommendations)
    .where(eq(titleRecommendations.titleId, titleId))
    .orderBy(titleRecommendations.rank)
    ;
}

export function getTitleByIdOrNull(titleId: string) {
  return db.select().from(titles).where(eq(titles.id, titleId));
}

// ─── Upcoming feed queries ──────────────────────────────────────────

export function getUpcomingEpisodes(
  userId: string,
  fromDate: string,
  toDate: string,
  statusFilter?: string[],
) {
  // 28.08, Sid — real bug: this query never excluded "dropped" titles, so a
  // series marked dropped ("de la merde") with a future air date kept
  // reappearing in the Upcoming feed.
  const conditions = [
    gte(episodes.airDate, fromDate),
    lte(episodes.airDate, toDate),
    ne(userTitleStatus.status, "dropped"),
  ];
  if (statusFilter && statusFilter.length > 0) {
    conditions.push(
      sql`${userTitleStatus.status} IN (${sql.join(
        statusFilter.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  }

  return db
    .select({
      episodeId: episodes.id,
      titleId: titles.id,
      titleName: titles.title,
      posterPath: titles.posterPath,
      posterThumbHash: titles.posterThumbHash,
      backdropPath: titles.backdropPath,
      backdropThumbHash: titles.backdropThumbHash,
      seasonNumber: seasons.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      episodeName: episodes.name,
      airDate: episodes.airDate,
      userStatus: userTitleStatus.status,
    })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .innerJoin(titles, and(eq(seasons.titleId, titles.id), eq(titles.type, "tv")))
    .innerJoin(
      userTitleStatus,
      and(eq(userTitleStatus.titleId, titles.id), eq(userTitleStatus.userId, userId)),
    )
    .where(and(...conditions))
    .orderBy(asc(episodes.airDate), asc(titles.title))
    ;
}

export function getUpcomingMovies(
  userId: string,
  fromDate: string,
  toDate: string,
  statusFilter?: string[],
) {
  const conditions = [
    eq(titles.type, "movie"),
    gte(titles.releaseDate, fromDate),
    lte(titles.releaseDate, toDate),
    ne(userTitleStatus.status, "dropped"),
  ];
  if (statusFilter && statusFilter.length > 0) {
    conditions.push(
      sql`${userTitleStatus.status} IN (${sql.join(
        statusFilter.map((s) => sql`${s}`),
        sql`, `,
      )})`,
    );
  }

  return db
    .select({
      titleId: titles.id,
      titleName: titles.title,
      posterPath: titles.posterPath,
      posterThumbHash: titles.posterThumbHash,
      backdropPath: titles.backdropPath,
      backdropThumbHash: titles.backdropThumbHash,
      releaseDate: titles.releaseDate,
      userStatus: userTitleStatus.status,
    })
    .from(titles)
    .innerJoin(
      userTitleStatus,
      and(eq(userTitleStatus.titleId, titles.id), eq(userTitleStatus.userId, userId)),
    )
    .where(and(...conditions))
    .orderBy(asc(titles.releaseDate), asc(titles.title))
    ;
}

export function getAvailabilityByTitleIds(titleIds: string[]) {
  if (titleIds.length === 0) return Promise.resolve([]);
  // Order by offerType so flatrate is picked first when the caller deduplicates
  return db
    .select({
      titleId: titleAvailability.titleId,
      platformId: platforms.id,
      providerName: platforms.name,
      logoPath: platforms.logoPath,
    })
    .from(titleAvailability)
    .innerJoin(platforms, eq(titleAvailability.platformId, platforms.id))
    .where(
      and(
        inArray(titleAvailability.titleId, titleIds),
        inArray(titleAvailability.offerType, ["flatrate", "free", "ads"]),
      ),
    )
    .orderBy(
      sql`CASE ${titleAvailability.offerType} WHEN 'flatrate' THEN 0 WHEN 'free' THEN 1 ELSE 2 END`,
    )
    ;
}
