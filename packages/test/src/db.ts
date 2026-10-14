import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool, types } from "pg";

import * as schema from "@sofa/db/schema";

// 08.10, Patoune TV / Postgres migration: tests vi.mock() the whole
// "@sofa/db/client" module (see ./setup.ts), so that module's own
// types.setTypeParser() calls (bigint/numeric → real numbers) never run —
// `pg`'s type parser table is global per-process, so it has to be
// registered here too, against this same shared module instance.
types.setTypeParser(20, (val) => Number.parseInt(val, 10));
types.setTypeParser(1700, (val) => Number.parseFloat(val));

const {
  user,
  titles,
  seasons,
  episodes,
  userMovieWatches,
  userEpisodeWatches,
  userTitleStatus,
  userRatings,
  platformTmdbIds,
  platforms,
  titleAvailability,
  userPlatforms,
  titleRecommendations,
  integrations,
} = schema;

// 08.10, Patoune TV / Postgres migration: a real Postgres database, not
// SQLite's in-process :memory: — Postgres has no in-memory mode, so tests
// share one real database (same pattern the old :memory: singleton already
// used: one shared instance for the whole packages/core test run,
// clearAllTables() between tests). Point TEST_DATABASE_URL at a dedicated
// database, never the app's real one — defaults to the "patounetv_test"
// database living alongside the real "patounetv" one on the same Postgres
// server.
const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://patounetv:patounetv@localhost:5432/patounetv_test";

export const testPool = new Pool({ connectionString: TEST_DATABASE_URL });
export const testDb = drizzle({ client: testPool, schema });

export async function applyMigrations() {
  const dbPkgDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "db",
    "drizzle",
  );
  await migrate(testDb, { migrationsFolder: dbPkgDir });
}

export async function clearAllTables() {
  const { rows } = await testPool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (rows.length === 0) return;
  const tableList = rows.map((r) => `"${r.tablename}"`).join(", ");
  await testPool.query(`TRUNCATE TABLE ${tableList} CASCADE`);
}

const now = new Date();

export async function insertUser(id = "user-1") {
  await testDb.insert(user).values({
    id,
    name: "Test User",
    email: `${id}@test.com`,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function insertTitle(
  overrides: {
    id?: string;
    tmdbId?: number;
    tvdbId?: number;
    type?: "movie" | "tv";
    title?: string;
    releaseDate?: string;
    posterPath?: string;
    status?: string;
  } = {},
) {
  const id = overrides.id ?? "title-1";
  await testDb.insert(titles).values({
    id,
    tmdbId: overrides.tmdbId ?? 12345,
    tvdbId: overrides.tvdbId,
    type: overrides.type ?? "movie",
    title: overrides.title ?? "Test Movie",
    // RECOMMENDATION_MIN_YEAR (packages/db/src/queries/discovery.ts) floors
    // recommendations to the 2000s — a fixture title with no release date
    // at all used to silently fail that filter in every recommendation test.
    releaseDate: overrides.releaseDate ?? "2020-01-01",
    posterPath: overrides.posterPath,
    status: overrides.status,
  });
  return id;
}

export async function insertTvShow(
  titleId = "tv-1",
  tmdbId = 99999,
  seasonCount = 1,
  epsPerSeason = 3,
  options: { title?: string; airDates?: string[]; status?: string } = {},
) {
  await insertTitle({
    id: titleId,
    tmdbId,
    type: "tv",
    title: options.title ?? "Test Show",
    status: options.status,
  });
  const episodeIds: string[] = [];
  let airDateIdx = 0;
  for (let s = 1; s <= seasonCount; s++) {
    const seasonId = `${titleId}-s${s}`;
    await testDb.insert(seasons).values({ id: seasonId, titleId, seasonNumber: s });
    for (let e = 1; e <= epsPerSeason; e++) {
      const epId = `${titleId}-s${s}e${e}`;
      await testDb.insert(episodes).values({
        id: epId,
        seasonId,
        episodeNumber: e,
        name: `S${s}E${e}`,
        airDate: options.airDates?.[airDateIdx],
        // getOwnedEpisodesBySeasonIds() only surfaces episodes actually
        // downloaded on Emby — a fixture episode needs this set to behave
        // like a real one in getContinueWatchingFeed().
        embyItemId: epId,
      });
      episodeIds.push(epId);
      airDateIdx++;
    }
  }
  return { titleId, episodeIds };
}

export async function insertMovieWatch(userId: string, titleId: string, watchedAt?: Date) {
  await testDb.insert(userMovieWatches).values({
    userId,
    titleId,
    watchedAt: watchedAt ?? new Date(),
    source: "manual",
  });
}

export async function insertEpisodeWatch(userId: string, episodeId: string, watchedAt?: Date) {
  await testDb.insert(userEpisodeWatches).values({
    userId,
    episodeId,
    watchedAt: watchedAt ?? new Date(),
    source: "manual",
  });
}

export async function insertStatus(
  userId: string,
  titleId: string,
  status: "watchlist" | "in_progress" | "completed",
) {
  const timestamp = new Date();
  await testDb
    .insert(userTitleStatus)
    .values({ userId, titleId, status, addedAt: timestamp, updatedAt: timestamp });
}

export async function insertRating(userId: string, titleId: string, ratingStars: number) {
  await testDb.insert(userRatings).values({ userId, titleId, ratingStars, ratedAt: new Date() });
}

export async function insertPlatform(
  overrides: {
    id?: string;
    name?: string;
    tmdbProviderId?: number;
    tmdbProviderIds?: number[];
    logoPath?: string;
    urlTemplate?: string;
  } = {},
) {
  const id = overrides.id ?? "platform-1";
  await testDb.insert(platforms).values({
    id,
    name: overrides.name ?? "Netflix",
    logoPath: overrides.logoPath ?? "/logo.png",
    urlTemplate: overrides.urlTemplate ?? "https://www.netflix.com/search?q={title}",
  });

  const tmdbIds = overrides.tmdbProviderIds ?? [overrides.tmdbProviderId ?? 8];
  for (const tmdbId of tmdbIds) {
    await testDb.insert(platformTmdbIds).values({ platformId: id, tmdbProviderId: tmdbId });
  }
  return id;
}

export async function insertTitleAvailability(
  titleId: string,
  platformId: string,
  overrides: {
    offerType?: "flatrate" | "rent" | "buy" | "free" | "ads";
    region?: string;
  } = {},
) {
  await testDb.insert(titleAvailability).values({
    titleId,
    platformId,
    offerType: overrides.offerType ?? "flatrate",
    region: overrides.region ?? "US",
    lastFetchedAt: new Date(),
  });
}

export async function insertUserPlatform(userId: string, platformId: string) {
  await testDb.insert(userPlatforms).values({ userId, platformId });
}

export async function insertIntegration(userId: string, provider: string, token = "test-token") {
  const type = provider === "sonarr" || provider === "radarr" ? "list" : "webhook";
  const [row] = await testDb
    .insert(integrations)
    .values({
      userId,
      provider,
      type,
      token,
      enabled: true,
      createdAt: new Date(),
    })
    .returning();
  return row;
}

export async function insertRecommendation(
  titleId: string,
  recommendedTitleId: string,
  overrides: {
    source?: "tmdb_recommendations" | "tmdb_similar";
    rank?: number;
  } = {},
) {
  await testDb.insert(titleRecommendations).values({
    titleId,
    recommendedTitleId,
    source: overrides.source ?? "tmdb_recommendations",
    rank: overrides.rank ?? 1,
  });
}

export {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  notInArray,
  or,
  sql,
} from "drizzle-orm";
