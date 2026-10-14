import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "../client";
import {
  episodes,
  genres,
  platforms,
  seasons,
  titleAvailability,
  titleGenres,
  titleRecommendations,
  titles,
} from "../schema";

// ─── Title CRUD ──────────────────────────────────────────────────────

/**
 * Insert a title row with returning, or return the existing row if a concurrent
 * insert wins the race (Postgres unique_violation, SQLSTATE 23505).
 */
export async function insertTitleReturning(values: typeof titles.$inferInsert) {
  try {
    return await db.insert(titles).values(values).returning();
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "23505") {
      return db
        .select()
        .from(titles)
        .where(and(eq(titles.tmdbId, values.tmdbId), eq(titles.type, values.type)));
    }
    throw err;
  }
}

export function getTitleByTmdbId(tmdbId: number) {
  return db.select().from(titles).where(eq(titles.tmdbId, tmdbId));
}

export function getTitleByTmdbIdAndType(tmdbId: number, type: "movie" | "tv") {
  return db
    .select()
    .from(titles)
    .where(and(eq(titles.tmdbId, tmdbId), eq(titles.type, type)));
}

export async function updateTitleFields(
  titleId: string,
  values: Partial<typeof titles.$inferInsert>,
): Promise<void> {
  await db.update(titles).set(values).where(eq(titles.id, titleId));
}

export async function updateTrailerKey(titleId: string, key: string | null): Promise<void> {
  await db.update(titles).set({ trailerVideoKey: key }).where(eq(titles.id, titleId));
}

// ─── Genres ──────────────────────────────────────────────────────────

interface TmdbGenreInput {
  id: number;
  name?: string;
}

/**
 * Upsert genre rows and re-link them to a title in a single transaction.
 * Filters out genres without a name.
 */
export async function upsertGenresTransaction(
  titleId: string,
  tmdbGenres: TmdbGenreInput[],
): Promise<void> {
  const validGenres = tmdbGenres.filter((g): g is TmdbGenreInput & { name: string } => !!g.name);
  if (validGenres.length === 0) return;
  await db.transaction(async (tx) => {
    await tx
      .insert(genres)
      .values(validGenres.map((g) => ({ id: g.id, name: g.name })))
      .onConflictDoUpdate({ target: genres.id, set: { name: sql`excluded.name` } });

    await tx.delete(titleGenres).where(eq(titleGenres.titleId, titleId));
    await tx
      .insert(titleGenres)
      .values(validGenres.map((g) => ({ titleId, genreId: g.id })))
      .onConflictDoNothing();
  });
}

export function getTitleGenres(titleId: string) {
  return db
    .select({ name: genres.name })
    .from(titleGenres)
    .innerJoin(genres, eq(titleGenres.genreId, genres.id))
    .where(eq(titleGenres.titleId, titleId));
}

// ─── Seasons ─────────────────────────────────────────────────────────

export async function hasSeasonForTitle(titleId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: seasons.id })
    .from(seasons)
    .where(eq(seasons.titleId, titleId))
    .limit(1);
  return row != null;
}

export function getExistingSeasonInfo(titleId: string, seasonNumber: number) {
  return db
    .select({
      id: seasons.id,
      posterPath: seasons.posterPath,
    })
    .from(seasons)
    .where(and(eq(seasons.titleId, titleId), eq(seasons.seasonNumber, seasonNumber)));
}

export function upsertSeasonReturning(values: {
  titleId: string;
  seasonNumber: number;
  name: string | null;
  overview: string | null;
  posterPath: string | null;
  airDate: string | null;
  lastFetchedAt: Date;
}) {
  return db
    .insert(seasons)
    .values(values)
    .onConflictDoUpdate({
      target: [seasons.titleId, seasons.seasonNumber],
      set: {
        name: values.name,
        overview: values.overview,
        posterPath: values.posterPath,
        airDate: values.airDate,
        lastFetchedAt: values.lastFetchedAt,
      },
    })
    .returning();
}

export function getSeasonsForTitle(titleId: string) {
  return db.select().from(seasons).where(eq(seasons.titleId, titleId)).orderBy(seasons.seasonNumber);
}

export async function nullifySeasonThumbHash(seasonId: string): Promise<void> {
  await db.update(seasons).set({ posterThumbHash: null }).where(eq(seasons.id, seasonId));
}

// ─── Episodes ────────────────────────────────────────────────────────

export async function getOldEpisodeStills(
  seasonId: string,
): Promise<Map<number, string | null>> {
  const rows = await db
    .select({
      episodeNumber: episodes.episodeNumber,
      stillPath: episodes.stillPath,
    })
    .from(episodes)
    .where(eq(episodes.seasonId, seasonId));
  return new Map(rows.map((e) => [e.episodeNumber, e.stillPath] as const));
}

interface EpisodeUpsertInput {
  episode_number: number;
  name: string | null;
  overview: string | null;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
}

/**
 * Upsert all episodes for a season in a single transaction.
 */
export async function batchUpsertEpisodes(
  seasonId: string,
  eps: EpisodeUpsertInput[],
): Promise<void> {
  if (eps.length === 0) return;
  await db.transaction(async (tx) => {
    for (const ep of eps) {
      await tx
        .insert(episodes)
        .values({
          seasonId,
          episodeNumber: ep.episode_number,
          name: ep.name,
          overview: ep.overview,
          stillPath: ep.still_path,
          airDate: ep.air_date,
          runtimeMinutes: ep.runtime,
        })
        .onConflictDoUpdate({
          target: [episodes.seasonId, episodes.episodeNumber],
          set: {
            name: ep.name,
            overview: ep.overview,
            stillPath: ep.still_path,
            airDate: ep.air_date,
            runtimeMinutes: ep.runtime,
          },
        });
    }
  });
}

export function getSeasonEpisodesWithHashes(seasonId: string) {
  return db
    .select({
      id: episodes.id,
      episodeNumber: episodes.episodeNumber,
      stillPath: episodes.stillPath,
      stillThumbHash: episodes.stillThumbHash,
    })
    .from(episodes)
    .where(eq(episodes.seasonId, seasonId));
}

export async function nullifyEpisodeThumbHash(episodeId: string): Promise<void> {
  await db.update(episodes).set({ stillThumbHash: null }).where(eq(episodes.id, episodeId));
}

export function getEpisodesBySeasonIds(seasonIds: string[]) {
  if (seasonIds.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(episodes)
    .where(inArray(episodes.seasonId, seasonIds))
    .orderBy(episodes.seasonId, episodes.episodeNumber);
}

/** Cheap COUNT(*) — used to decide whether a show is small enough for the
 * TVDB per-episode translation pass before paying for the fetch+write. */
export async function countEpisodesForTitle(titleId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(episodes)
    .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
    .where(eq(seasons.titleId, titleId));
  return row?.count ?? 0;
}

/**
 * Batch-set the Emby item ID for episodes, matched by (seasonId, episodeNumber).
 */
export async function setEpisodeEmbyItemIds(
  updates: { seasonId: string; episodeNumber: number; embyItemId: string }[],
): Promise<void> {
  if (updates.length === 0) return;
  await db.transaction(async (tx) => {
    for (const u of updates) {
      await tx
        .update(episodes)
        .set({ embyItemId: u.embyItemId })
        .where(and(eq(episodes.seasonId, u.seasonId), eq(episodes.episodeNumber, u.episodeNumber)));
    }
  });
}

/**
 * Batch-set French name/overview for episodes, matched by (seasonId,
 * episodeNumber) — same convention as setEpisodeEmbyItemIds. Skips a field
 * when the translation didn't have it, rather than overwriting existing
 * text with null.
 */
export async function setEpisodeFrenchTranslations(
  updates: { seasonId: string; episodeNumber: number; nameFr: string | null; overviewFr: string | null }[],
): Promise<void> {
  if (updates.length === 0) return;
  await db.transaction(async (tx) => {
    for (const u of updates) {
      if (u.nameFr === null && u.overviewFr === null) continue;
      const set: { nameFr?: string; overviewFr?: string } = {};
      if (u.nameFr !== null) set.nameFr = u.nameFr;
      if (u.overviewFr !== null) set.overviewFr = u.overviewFr;
      await tx
        .update(episodes)
        .set(set)
        .where(and(eq(episodes.seasonId, u.seasonId), eq(episodes.episodeNumber, u.episodeNumber)));
    }
  });
}

export async function markTvdbTranslated(titleId: string): Promise<void> {
  await db.update(titles).set({ tvdbTranslatedAt: new Date() }).where(eq(titles.id, titleId));
}

/**
 * Select episodes that need a still thumb hash (have a stillPath but no hash).
 */
export function getEpisodesNeedingStillHash(seasonIds: string[]) {
  if (seasonIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: episodes.id,
      stillPath: episodes.stillPath,
    })
    .from(episodes)
    .where(
      and(
        inArray(episodes.seasonId, seasonIds),
        isNotNull(episodes.stillPath),
        sql`${episodes.stillThumbHash} IS NULL`,
      ),
    );
}

// ─── Availability ────────────────────────────────────────────────────

export function getAvailabilityOffersForTitle(titleId: string) {
  return db
    .select({
      platformId: platforms.id,
      providerName: platforms.name,
      logoPath: platforms.logoPath,
      urlTemplate: platforms.urlTemplate,
      offerType: titleAvailability.offerType,
    })
    .from(titleAvailability)
    .innerJoin(platforms, eq(titleAvailability.platformId, platforms.id))
    .where(eq(titleAvailability.titleId, titleId));
}

// ─── Recommendations ─────────────────────────────────────────────────

export async function hasRecommendationsForTitle(titleId: string): Promise<boolean> {
  const [row] = await db
    .select({ titleId: titleRecommendations.titleId })
    .from(titleRecommendations)
    .where(eq(titleRecommendations.titleId, titleId))
    .limit(1);
  return row != null;
}

interface RecommendationTitleInput {
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  originalTitle: string | null;
  overview: string | null;
  releaseDate: string | null;
  firstAirDate: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  popularity: number | null;
  voteAverage: number | null;
  voteCount: number | null;
}

interface RecommendationRowInput {
  tmdbId: number;
  source: "tmdb_recommendations" | "tmdb_similar";
  rank: number;
}

/**
 * Large transaction: upsert shell titles for recommendations, then upsert
 * the recommendation link rows. Returns the titleIdMap (tmdbId -> titleId)
 * so the caller can fire off thumbhash generation.
 */
export async function upsertRecommendationsTransaction(
  titleId: string,
  uniqueTitles: Map<number, RecommendationTitleInput>,
  allItems: RecommendationRowInput[],
  now: Date,
): Promise<Map<number, string>> {
  const tmdbIds = [...uniqueTitles.keys()];

  return db.transaction(async (tx) => {
    // Batch prefetch existing titles (1 query)
    const existingTitles = await tx
      .select({
        id: titles.id,
        tmdbId: titles.tmdbId,
        type: titles.type,
        posterPath: titles.posterPath,
        backdropPath: titles.backdropPath,
        posterThumbHash: titles.posterThumbHash,
        backdropThumbHash: titles.backdropThumbHash,
      })
      .from(titles)
      .where(inArray(titles.tmdbId, tmdbIds));

    // Key by (tmdbId, type) composite since the unique constraint is on both columns.
    // The same tmdbId can exist as both a movie and TV show.
    const existingTitleMap = new Map(existingTitles.map((t) => [`${t.tmdbId}-${t.type}`, t]));
    const titleIdMap = new Map<number, string>();
    for (const [tmdbId, item] of uniqueTitles) {
      const existing = existingTitleMap.get(`${tmdbId}-${item.type}`);
      if (existing) {
        titleIdMap.set(tmdbId, existing.id);
      }
    }

    const insertedTmdbIds = new Set<number>();
    for (const item of uniqueTitles.values()) {
      const existingTitle = existingTitleMap.get(`${item.tmdbId}-${item.type}`);
      if (existingTitle) {
        const posterPathChanged = existingTitle.posterPath !== item.posterPath;
        const backdropPathChanged = existingTitle.backdropPath !== item.backdropPath;

        await tx
          .update(titles)
          .set({
            type: item.type,
            title: item.title,
            originalTitle: item.originalTitle,
            overview: item.overview,
            releaseDate: item.releaseDate,
            firstAirDate: item.firstAirDate,
            posterPath: item.posterPath,
            backdropPath: item.backdropPath,
            popularity: item.popularity,
            voteAverage: item.voteAverage,
            voteCount: item.voteCount,
            ...(posterPathChanged
              ? {
                  posterThumbHash: null,
                  colorPalette: null,
                }
              : {}),
            ...(backdropPathChanged
              ? {
                  backdropThumbHash: null,
                }
              : {}),
          })
          .where(eq(titles.id, existingTitle.id));
        continue;
      }

      insertedTmdbIds.add(item.tmdbId);
      const [row] = await tx
        .insert(titles)
        .values({
          tmdbId: item.tmdbId,
          type: item.type,
          title: item.title,
          originalTitle: item.originalTitle,
          overview: item.overview,
          releaseDate: item.releaseDate,
          firstAirDate: item.firstAirDate,
          posterPath: item.posterPath,
          backdropPath: item.backdropPath,
          popularity: item.popularity,
          voteAverage: item.voteAverage,
          voteCount: item.voteCount,
          lastFetchedAt: null,
        })
        .onConflictDoNothing()
        .returning();
      if (row) titleIdMap.set(item.tmdbId, row.id);
    }

    // One fallback query for any that conflicted
    const stillMissing = [...insertedTmdbIds].filter((id) => !titleIdMap.has(id));
    if (stillMissing.length > 0) {
      const fallbacks = await tx
        .select({ id: titles.id, tmdbId: titles.tmdbId, type: titles.type })
        .from(titles)
        .where(inArray(titles.tmdbId, stillMissing));

      for (const f of fallbacks) {
        // Only map if the type matches what we were trying to insert
        const expected = uniqueTitles.get(f.tmdbId);
        if (expected && expected.type === f.type) {
          titleIdMap.set(f.tmdbId, f.id);
        }
      }
    }

    // Batch upsert all recommendation rows
    const recRows = allItems
      .map((item) => {
        const recTitleId = titleIdMap.get(item.tmdbId);
        if (!recTitleId) return null;
        return {
          titleId,
          recommendedTitleId: recTitleId,
          source: item.source,
          rank: item.rank,
          lastFetchedAt: now,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (recRows.length > 0) {
      await tx
        .insert(titleRecommendations)
        .values(recRows)
        .onConflictDoUpdate({
          target: [
            titleRecommendations.titleId,
            titleRecommendations.recommendedTitleId,
            titleRecommendations.source,
          ],
          set: {
            rank: sql`excluded.rank`,
            lastFetchedAt: sql`excluded."lastFetchedAt"`,
          },
        });
    }

    return titleIdMap;
  });
}

// ─── Poster hash helpers ─────────────────────────────────────────────

export function getTitlesNeedingPosterHash(titleIds: string[]) {
  if (titleIds.length === 0) return Promise.resolve([]);
  return db
    .select({ id: titles.id, posterPath: titles.posterPath })
    .from(titles)
    .where(
      and(
        inArray(titles.id, titleIds),
        isNotNull(titles.posterPath),
        sql`${titles.posterThumbHash} IS NULL`,
      ),
    );
}

// ─── Browse batch upsert ─────────────────────────────────────────────

interface BrowseTitleInput {
  tmdbId: number;
  type: "movie" | "tv";
  title: string;
  posterPath: string | null;
  backdropPath?: string | null;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  overview?: string | null;
  popularity?: number | null;
  voteAverage?: number | null;
  voteCount?: number | null;
}

/**
 * Ensure every browse/search result has a local title row.
 * Inserts shell titles (`lastFetchedAt = null`) for new (tmdbId, type) pairs.
 * Returns a map keyed by `${tmdbId}-${type}` -> `{ id, posterThumbHash }`.
 */
export async function ensureBrowseTitlesTransaction(
  items: BrowseTitleInput[],
): Promise<Map<string, { id: string; posterThumbHash: string | null }>> {
  if (items.length === 0) return new Map();

  // Deduplicate by (tmdbId, type)
  const unique = new Map<string, BrowseTitleInput>();
  for (const item of items) {
    const key = `${item.tmdbId}-${item.type}`;
    if (!unique.has(key)) unique.set(key, item);
  }

  const tmdbIds = [...new Set(items.map((i) => i.tmdbId))];

  return db.transaction(async (tx) => {
    // Batch-fetch existing titles (1 query)
    const existing = await tx
      .select({
        id: titles.id,
        tmdbId: titles.tmdbId,
        type: titles.type,
        posterThumbHash: titles.posterThumbHash,
      })
      .from(titles)
      .where(inArray(titles.tmdbId, tmdbIds));

    const result = new Map<string, { id: string; posterThumbHash: string | null }>();
    for (const row of existing) {
      result.set(`${row.tmdbId}-${row.type}`, {
        id: row.id,
        posterThumbHash: row.posterThumbHash,
      });
    }

    // Find items that need inserting
    const missingKeys = [...unique.keys()].filter((key) => !result.has(key));
    if (missingKeys.length === 0) return result;

    for (const key of missingKeys) {
      const item = unique.get(key);
      if (!item) continue;
      const [row] = await tx
        .insert(titles)
        .values({
          tmdbId: item.tmdbId,
          type: item.type,
          title: item.title,
          overview: item.overview ?? null,
          releaseDate: item.releaseDate ?? null,
          firstAirDate: item.firstAirDate ?? null,
          posterPath: item.posterPath,
          backdropPath: item.backdropPath ?? null,
          popularity: item.popularity ?? null,
          voteAverage: item.voteAverage ?? null,
          voteCount: item.voteCount ?? null,
          lastFetchedAt: null,
        })
        .onConflictDoNothing()
        .returning({ id: titles.id, posterThumbHash: titles.posterThumbHash });
      if (row) {
        result.set(key, {
          id: row.id,
          posterThumbHash: row.posterThumbHash,
        });
      }
    }

    // Fallback for any that conflicted (concurrent insert)
    const stillMissing = missingKeys.filter((key) => !result.has(key));
    if (stillMissing.length > 0) {
      const missingTmdbIds = stillMissing.map((key) => unique.get(key)?.tmdbId ?? 0);
      const fallbacks = await tx
        .select({
          id: titles.id,
          tmdbId: titles.tmdbId,
          type: titles.type,
          posterThumbHash: titles.posterThumbHash,
        })
        .from(titles)
        .where(inArray(titles.tmdbId, missingTmdbIds));
      for (const f of fallbacks) {
        result.set(`${f.tmdbId}-${f.type}`, {
          id: f.id,
          posterThumbHash: f.posterThumbHash,
        });
      }
    }

    return result;
  });
}
