import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "../client";
import {
  genres,
  titleAvailability,
  titleEpisodeStats,
  titleGenres,
  titles,
  userEpisodeWatches,
  userMovieWatches,
  userPlatforms,
  userRatings,
  userTitleStatus,
} from "../schema";

// ─── Display status SQL ─────────────────────────────────────────────
// Derives the user-facing display status inline for filtering/output.
// Mirrors the logic in @sofa/core/display-status.ts.
//
// 21.08: previously built 2 correlated subqueries (aired/watched episode
// counts, each with its own episodes+seasons join) referenced inline in a
// CASE expression that itself got embedded twice (WHERE for filtering,
// SELECT for output) — with the aired-count subquery appearing twice
// within the CASE itself. That's up to 6 correlated-subquery executions
// per title row, each doing a multi-table join, re-run for every title in
// the user's tracked library on every library list load. Confirmed via
// production logs as the real cause of a synchronous, CPU-bound,
// multi-minute freeze (POST /rpc/library/list took 265s) with zero
// external network calls involved — this runs entirely inside bun:sqlite,
// which is synchronous and blocks the whole single-threaded server.
// Fixed by computing aired/watched counts ONCE per title via a single
// grouped join, referenced as plain columns everywhere else instead of
// re-executed subqueries — got this down to 11.7s.
//
// 18.09, Sid: "sofa c'est de nouveau lent... régulièrement long à
// l'ouverture" — 11.7s was an accepted cost at 21.08's catalog size, but
// this GROUP BY is unscoped to the user's own tracked titles ON PURPOSE
// (scoping first was tried and measured SLOWER — 17.8s, see the git
// history of this file for the full note on why), so its cost scales with
// the ENTIRE episodes table regardless of library size. Grew past ~30s
// once the catalog reached 157k episodes (one show, "Plus belle la vie",
// added 4667 the same day this was found). Rather than trying a 3rd
// variant of the same live aggregation, this is now precomputed by
// title-episode-stats-worker.ts on its own thread, refreshed every few
// minutes and read here as a plain indexed table — a request never
// computes this itself anymore.
function displayStatusExpr(episodeStats: typeof titleEpisodeStats) {
  // Order must match @sofa/core/display-status.ts:
  // 1. watchlist → in_watchlist (any type)
  // 2. movie → completed if stored=completed, else in_watchlist
  // 3. TV completed → completed
  // 4. TV in_progress → check episode progress
  return sql<string>`(
    CASE
      WHEN ${userTitleStatus.status} = 'watchlist' THEN 'in_watchlist'
      WHEN ${titles.type} = 'movie' THEN
        CASE WHEN ${userTitleStatus.status} = 'completed' THEN 'completed' ELSE 'in_watchlist' END
      WHEN ${userTitleStatus.status} = 'completed' THEN 'completed'
      WHEN COALESCE(${episodeStats.airedCount}, 0) > 0
        AND ${episodeStats.airedCount} = COALESCE(${episodeStats.watchedCount}, 0)
      THEN CASE
        WHEN ${titles.status} IN ('Returning Series', 'In Production') THEN 'caught_up'
        ELSE 'completed'
      END
      ELSE 'watching'
    END
  )`;
}

// ─── Filtered library feed ──────────────────────────────────────────

export interface LibraryFilters {
  search?: string;
  statuses?: string[];
  type?: "movie" | "tv";
  genreId?: number;
  ratingMin?: number;
  ratingMax?: number;
  yearMin?: number;
  yearMax?: number;
  contentRating?: string;
  onMyServices?: boolean;
  sortBy: string;
  sortDirection: "asc" | "desc";
  page: number;
  limit: number;
}

export async function getFilteredLibrary(userId: string, filters: LibraryFilters) {
  const offset = (filters.page - 1) * filters.limit;
  // Only "in_watchlist" maps 1:1 to a stored status. The others (watching, caught_up, completed)
  // all involve derived logic from episode progress / TMDB show status, so we need the full
  // display-status SQL computation to filter them correctly.
  const needsDisplayStatus =
    filters.statuses &&
    filters.statuses.some((s) => s === "watching" || s === "caught_up" || s === "completed");

  // Build WHERE conditions
  const conditions = [eq(userTitleStatus.userId, userId)];

  if (filters.search) {
    // 08.10, Patoune TV / Postgres migration: plain LIKE is case-sensitive
    // in Postgres, unlike SQLite's default ASCII-insensitive LIKE — a
    // search for "matrix" stopped matching "The Matrix" until this moved
    // to ILIKE.
    conditions.push(sql`${titles.title} ILIKE ${"%" + filters.search + "%"}`);
  }

  if (filters.type) {
    conditions.push(eq(titles.type, filters.type));
  }

  if (filters.genreId) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${titleGenres} WHERE ${titleGenres.titleId} = ${titles.id} AND ${titleGenres.genreId} = ${filters.genreId})`,
    );
  }

  if (filters.ratingMin != null || filters.ratingMax != null) {
    conditions.push(sql`${userRatings.ratingStars} IS NOT NULL`);
    if (filters.ratingMin != null) {
      conditions.push(gte(userRatings.ratingStars, filters.ratingMin));
    }
    if (filters.ratingMax != null) {
      conditions.push(lte(userRatings.ratingStars, filters.ratingMax));
    }
  }

  if (filters.yearMin != null || filters.yearMax != null) {
    const yearExpr = sql`CAST(EXTRACT(YEAR FROM COALESCE(${titles.releaseDate}, ${titles.firstAirDate})::date) AS INTEGER)`;
    if (filters.yearMin != null) {
      conditions.push(sql`${yearExpr} >= ${filters.yearMin}`);
    }
    if (filters.yearMax != null) {
      conditions.push(sql`${yearExpr} <= ${filters.yearMax}`);
    }
  }

  if (filters.contentRating) {
    conditions.push(eq(titles.contentRating, filters.contentRating));
  }

  if (filters.onMyServices) {
    // Check if user has platforms set; if so, filter to titles available on their services
    const [userPlatformRow] = await db
      .select({ platformId: userPlatforms.platformId })
      .from(userPlatforms)
      .where(eq(userPlatforms.userId, userId))
      .limit(1);

    if (userPlatformRow) {
      conditions.push(
        sql`EXISTS (
          SELECT 1 FROM ${titleAvailability} ta
          JOIN ${userPlatforms} up ON ta.platformId = up.platformId
          WHERE ta.titleId = ${titles.id} AND up.userId = ${userId}
        )`,
      );
    } else {
      // Fallback: any availability
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${titleAvailability} WHERE ${titleAvailability.titleId} = ${titles.id})`,
      );
    }
  }

  // Status filtering: optimize simple cases
  if (filters.statuses && filters.statuses.length > 0 && !needsDisplayStatus) {
    // Map display statuses to stored statuses for simple cases
    const storedStatuses: string[] = [];
    for (const s of filters.statuses) {
      if (s === "in_watchlist") storedStatuses.push("watchlist");
      if (s === "completed") storedStatuses.push("completed");
      // Real bug found live (24.08, Sid — DroppedSeriesSection showing
      // ~860 titles instead of the real 5): "dropped" was missing from this
      // mapping entirely, so storedStatuses stayed empty and NO status
      // condition got added at all — the query silently returned the whole
      // library instead of just dropped titles.
      if (s === "dropped") storedStatuses.push("dropped");
    }
    if (storedStatuses.length === 1) {
      conditions.push(
        eq(userTitleStatus.status, storedStatuses[0] as "watchlist" | "completed" | "dropped"),
      );
    } else if (storedStatuses.length > 1) {
      conditions.push(
        sql`${userTitleStatus.status} IN (${sql.join(
          storedStatuses.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      );
    }
  }

  // Sort expression
  const dirFn = filters.sortDirection === "asc" ? asc : desc;
  const sortExpressions = [];

  switch (filters.sortBy) {
    case "title":
      sortExpressions.push(dirFn(titles.title));
      break;
    case "added_at":
      sortExpressions.push(dirFn(userTitleStatus.addedAt));
      break;
    case "release_date":
      sortExpressions.push(dirFn(sql`COALESCE(${titles.releaseDate}, ${titles.firstAirDate})`));
      break;
    case "popularity":
      sortExpressions.push(dirFn(titles.popularity));
      break;
    case "user_rating":
      // NULLS LAST: put unrated items at the end
      sortExpressions.push(
        asc(sql`CASE WHEN ${userRatings.ratingStars} IS NULL THEN 1 ELSE 0 END`),
      );
      sortExpressions.push(dirFn(userRatings.ratingStars));
      break;
    case "vote_average":
      sortExpressions.push(dirFn(titles.voteAverage));
      break;
    case "last_watched": {
      const lastWatchedExpr = sql`(
        SELECT MAX(w."watchedAt") FROM (
          SELECT "watchedAt" FROM "userMovieWatches" WHERE "userId" = ${userId} AND "titleId" = ${titles.id}
          UNION ALL
          SELECT ue."watchedAt" FROM "userEpisodeWatches" ue
          INNER JOIN "episodes" e ON ue."episodeId" = e.id
          INNER JOIN "seasons" s ON e."seasonId" = s.id
          WHERE ue."userId" = ${userId} AND s."titleId" = ${titles.id}
        ) w
      )`;
      // NULLS LAST: never-watched titles go to the end
      sortExpressions.push(asc(sql`CASE WHEN ${lastWatchedExpr} IS NULL THEN 1 ELSE 0 END`));
      sortExpressions.push(dirFn(lastWatchedExpr));
      break;
    }
    case "next_air_date": {
      const nextAirDateExpr = sql`(
        SELECT MIN(e."airDate") FROM "episodes" e
        INNER JOIN "seasons" s ON e."seasonId" = s.id
        WHERE s."titleId" = ${titles.id} AND e."airDate" >= CURRENT_DATE::text
      )`;
      // NULLS LAST: titles with no upcoming episode go to the end
      sortExpressions.push(asc(sql`CASE WHEN ${nextAirDateExpr} IS NULL THEN 1 ELSE 0 END`));
      sortExpressions.push(dirFn(nextAirDateExpr));
      break;
    }
    default:
      sortExpressions.push(desc(userTitleStatus.addedAt));
  }

  // Build query with display status when needed for filtering
  if (needsDisplayStatus) {
    const episodeStats = titleEpisodeStats;

    // Filter by display status in SQL so pagination works at the DB level
    const statusValues = filters.statuses!.map((s) => sql`${s}`);
    conditions.push(
      sql`(${displayStatusExpr(episodeStats)}) IN (${sql.join(statusValues, sql`, `)})`,
    );

    const rows = await db
      .select({
        titleId: titles.id,
        title: titles.title,
        type: titles.type,
        tmdbId: titles.tmdbId,
        posterPath: titles.posterPath,
        posterThumbHash: titles.posterThumbHash,
        releaseDate: titles.releaseDate,
        firstAirDate: titles.firstAirDate,
        status: titles.status,
        voteAverage: titles.voteAverage,
        popularity: titles.popularity,
        inEmbyLibrary: titles.inEmbyLibrary,
        embyItemId: titles.embyItemId,
        userStatus: userTitleStatus.status,
        userRating: userRatings.ratingStars,
        displayStatus: displayStatusExpr(episodeStats).as("display_status"),
        totalCount: sql<number>`count(*) over()`.as("totalCount"),
      })
      .from(titles)
      .innerJoin(
        userTitleStatus,
        and(eq(userTitleStatus.titleId, titles.id), eq(userTitleStatus.userId, userId)),
      )
      .leftJoin(
        userRatings,
        and(eq(userRatings.titleId, titles.id), eq(userRatings.userId, userId)),
      )
      .leftJoin(
        episodeStats,
        and(eq(episodeStats.titleId, titles.id), eq(episodeStats.userId, userId)),
      )
      .where(and(...conditions))
      .orderBy(...sortExpressions)
      .limit(filters.limit)
      .offset(offset);

    const totalResults = rows[0]?.totalCount ?? 0;
    const items = rows.map(({ totalCount: _, ...item }) => item);

    return {
      items,
      page: filters.page,
      totalPages: Math.max(1, Math.ceil(totalResults / filters.limit)),
      totalResults,
    };
  }

  // Standard query (no display status computation needed)
  const rows = await db
    .select({
      titleId: titles.id,
      title: titles.title,
      type: titles.type,
      tmdbId: titles.tmdbId,
      posterPath: titles.posterPath,
      posterThumbHash: titles.posterThumbHash,
      releaseDate: titles.releaseDate,
      firstAirDate: titles.firstAirDate,
      status: titles.status,
      voteAverage: titles.voteAverage,
      popularity: titles.popularity,
      inEmbyLibrary: titles.inEmbyLibrary,
      embyItemId: titles.embyItemId,
      userStatus: userTitleStatus.status,
      userRating: userRatings.ratingStars,
      totalCount: sql<number>`count(*) over()`.as("totalCount"),
    })
    .from(titles)
    .innerJoin(
      userTitleStatus,
      and(eq(userTitleStatus.titleId, titles.id), eq(userTitleStatus.userId, userId)),
    )
    .leftJoin(userRatings, and(eq(userRatings.titleId, titles.id), eq(userRatings.userId, userId)))
    .where(and(...conditions))
    .orderBy(...sortExpressions)
    .limit(filters.limit)
    .offset(offset);

  const totalResults = rows[0]?.totalCount ?? 0;
  const items = rows.map(({ totalCount: _, ...item }) => item);

  return {
    items,
    page: filters.page,
    totalPages: Math.max(1, Math.ceil(totalResults / filters.limit)),
    totalResults,
  };
}

// ─── Library genres ─────────────────────────────────────────────────

export function getLibraryGenres(userId: string) {
  return db
    .select({
      id: genres.id,
      name: genres.name,
    })
    .from(genres)
    .innerJoin(titleGenres, eq(titleGenres.genreId, genres.id))
    .innerJoin(
      userTitleStatus,
      and(eq(userTitleStatus.titleId, titleGenres.titleId), eq(userTitleStatus.userId, userId)),
    )
    .groupBy(genres.id, genres.name)
    .orderBy(asc(genres.name))
    ;
}

// 25.08, Sid: "genres regardés" for the stats page — same join shape as
// getLibraryGenres above, but scoped to actually-watched titles
// (completed/caught_up, not just tracked) and ranked by count instead of
// name. A rewatched title still only counts once per genre here — this is
// about which genres she watches, not how many times.
export function getWatchedGenreStats(userId: string) {
  return db
    .select({
      id: genres.id,
      name: genres.name,
      count: sql<number>`count(distinct ${titleGenres.titleId})`,
    })
    .from(genres)
    .innerJoin(titleGenres, eq(titleGenres.genreId, genres.id))
    .innerJoin(
      userTitleStatus,
      and(
        eq(userTitleStatus.titleId, titleGenres.titleId),
        eq(userTitleStatus.userId, userId),
        sql`${userTitleStatus.status} IN ('completed', 'in_progress')`,
      ),
    )
    .groupBy(genres.id, genres.name)
    .orderBy(desc(sql`count(distinct ${titleGenres.titleId})`))
    ;
}
