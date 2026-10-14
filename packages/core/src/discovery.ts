import { getUntrackedEmbyLibraryTitleIds } from "@sofa/db/queries/emby-library";
import {
  getAllTrackedTitleIds,
  getAvailabilityByTitleIds,
  getEngagedTitleIds,
  getEpisodeWatchCountSince,
  getOwnedEpisodesBySeasonIds,
  getEpisodeWatchesByEpisodeIds,
  getEpisodeWatchHistoryBuckets,
  getHighlyRatedTitleIds,
  getInProgressTitleIds,
  getMovieWatchCountSince,
  getMovieWatchHistoryBuckets,
  getNewAvailableFeed,
  getRatingStats,
  getRecommendationRowsForTitle,
  getTopRecommendationRows,
  RECOMMENDATION_MIN_YEAR,
  getSeasonsByTitleIds,
  getTitleByIdOrNull,
  getTitlesByIds,
  getTotalEpisodeWatchMinutes,
  getTotalMovieWatchMinutes,
  getTvTitlesByIds,
  getUpcomingEpisodes,
  getUpcomingMovies,
  getUserStatusCounts,
} from "@sofa/db/queries/discovery";
import { getWatchedGenreStats } from "@sofa/db/queries/library";
import { tmdbImageUrl } from "@sofa/tmdb/image";

import type { DisplayStatus } from "./display-status";
import { getDisplayStatusesByTitleIds } from "./tracking";

function formatLocalDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type TimePeriod = "today" | "this_week" | "this_month" | "this_year";

export function periodStartTimestamp(period: TimePeriod): number {
  const now = new Date();
  const start = new Date(now);
  switch (period) {
    case "today":
      start.setHours(now.getHours() - 24, now.getMinutes(), 0, 0);
      break;
    case "this_week":
      start.setDate(now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      break;
    case "this_month":
      start.setDate(now.getDate() - 30);
      start.setHours(0, 0, 0, 0);
      break;
    case "this_year":
      start.setFullYear(now.getFullYear() - 1);
      start.setHours(0, 0, 0, 0);
      break;
  }
  return Math.floor(start.getTime() / 1000);
}

export async function getWatchCount(
  userId: string,
  table: "movies" | "episodes",
  period: TimePeriod,
): Promise<number> {
  const timestamp = periodStartTimestamp(period);
  if (table === "movies") {
    return getMovieWatchCountSince(userId, timestamp);
  }
  return getEpisodeWatchCountSince(userId, timestamp);
}

export interface HistoryBucket {
  bucket: string;
  count: number;
}

function toLocalDateBucket(date: Date): string {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function getWatchHistory(
  userId: string,
  table: "movies" | "episodes",
  period: TimePeriod,
): Promise<HistoryBucket[]> {
  const startTs = periodStartTimestamp(period);
  const now = new Date();

  let fmt: string;
  let buckets: string[];

  switch (period) {
    case "today":
      fmt = "%H";
      buckets = Array.from({ length: 24 }, (_, i) => {
        const d = new Date(now);
        d.setHours(now.getHours() - 23 + i);
        return d.getHours().toString().padStart(2, "0");
      });
      break;
    case "this_week": {
      fmt = "%Y-%m-%d";
      buckets = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(now);
        d.setDate(now.getDate() - 6 + i);
        return toLocalDateBucket(d);
      });
      break;
    }
    case "this_month": {
      fmt = "%Y-%m-%d";
      buckets = Array.from({ length: 30 }, (_, i) => {
        const d = new Date(now);
        d.setDate(now.getDate() - 29 + i);
        return toLocalDateBucket(d);
      });
      break;
    }
    case "this_year":
      fmt = "%Y-%m";
      buckets = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(now);
        d.setMonth(now.getMonth() - 11 + i);
        return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
      });
      break;
  }

  const rows =
    table === "movies"
      ? await getMovieWatchHistoryBuckets(userId, startTs, fmt)
      : await getEpisodeWatchHistoryBuckets(userId, startTs, fmt);

  const countMap = new Map(rows.map((r) => [r.bucket, r.count]));
  return buckets.map((b) => ({ bucket: b, count: countMap.get(b) ?? 0 }));
}

export interface DashboardStats {
  moviesThisMonth: number;
  episodesThisWeek: number;
  librarySize: number;
  completed: number;
}

export async function getLibraryStatistics(userId: string) {
  const titleIds = await getAllTrackedTitleIds(userId);
  const titleRecords = await getTitlesByIds(titleIds);
  const typeById = new Map(titleRecords.map((t) => [t.id, t.type]));
  const displayStatuses = await getDisplayStatusesByTitleIds(userId, titleIds);

  const mediaTypeDistribution = { movie: 0, tv: 0 };
  const statusDistribution: Record<DisplayStatus, number> = {
    in_watchlist: 0,
    watching: 0,
    caught_up: 0,
    completed: 0,
    dropped: 0,
  };
  const statusByType = {
    movie: { ...statusDistribution },
    tv: { ...statusDistribution },
  };

  for (const titleId of titleIds) {
    const type = typeById.get(titleId);
    const status = displayStatuses[titleId];
    if (!status) continue;
    statusDistribution[status]++;
    if (type === "movie" || type === "tv") {
      mediaTypeDistribution[type]++;
      statusByType[type][status]++;
    }
  }

  const ratingStats = await getRatingStats(userId);
  const librarySize = titleIds.length;

  const [totalMoviesWatched, totalEpisodesWatched, totalMovieMinutes, totalEpisodeMinutes, genreRows] =
    await Promise.all([
      getMovieWatchCountSince(userId, 0),
      getEpisodeWatchCountSince(userId, 0),
      getTotalMovieWatchMinutes(userId),
      getTotalEpisodeWatchMinutes(userId),
      getWatchedGenreStats(userId),
    ]);

  return {
    librarySize,
    totalMoviesWatched,
    totalEpisodesWatched,
    mediaTypeDistribution,
    statusDistribution,
    statusByType,
    averageRating: ratingStats.average,
    ratedCount: ratingStats.count,
    percentRated: librarySize > 0 ? Math.round((ratingStats.count / librarySize) * 100) : 0,
    // 25.08, Sid: all-time "time spent watching" + "genres watched" additions.
    totalWatchTimeMinutes: {
      movie: totalMovieMinutes,
      tv: totalEpisodeMinutes,
    },
    genreStats: genreRows.map((g) => ({ name: g.name, count: g.count })),
  };
}
export async function getUserStats(userId: string): Promise<DashboardStats> {
  const [moviesThisMonth, episodesThisWeek, statusCounts] = await Promise.all([
    getWatchCount(userId, "movies", "this_month"),
    getWatchCount(userId, "episodes", "this_week"),
    getUserStatusCounts(userId),
  ]);

  return {
    moviesThisMonth,
    episodesThisWeek,
    librarySize: statusCounts?.librarySize ?? 0,
    completed: statusCounts?.completed ?? 0,
  };
}

export interface ContinueWatchingItem {
  title: {
    id: string;
    title: string;
    posterPath: string | null;
    posterThumbHash: string | null;
    backdropPath: string | null;
    backdropThumbHash: string | null;
    type: string;
    firstAirDate: string | null;
    status: string | null;
    voteAverage: number | null;
    inEmbyLibrary: boolean;
    embyItemId: string | null;
  };
  nextEpisode: {
    id: string;
    seasonNumber: number;
    episodeNumber: number;
    name: string | null;
    stillPath: string | null;
    stillThumbHash: string | null;
    overview: string | null;
    embyItemId: string | null;
  } | null;
  lastWatchedAt: Date | null;
  lastAiredAt: Date | null;
  totalEpisodes: number;
  watchedEpisodes: number;
}

export type ContinueWatchingSortBy = "watched" | "aired";
export type ContinueWatchingSortDirection = "asc" | "desc";

export async function getContinueWatchingFeed(
  userId: string,
  sortBy: ContinueWatchingSortBy = "watched",
  sortDirection: ContinueWatchingSortDirection = "desc",
): Promise<ContinueWatchingItem[]> {
  // Get in-progress TV shows
  const inProgress = await getInProgressTitleIds(userId);

  if (inProgress.length === 0) return [];

  const titleIds = inProgress.map((r) => r.titleId);

  // Batch fetch all TV titles (1 query)
  const tvTitles = await getTvTitlesByIds(titleIds);

  if (tvTitles.length === 0) return [];

  const tvTitleIds = tvTitles.map((t) => t.id);
  const titleMap = new Map(tvTitles.map((t) => [t.id, t]));

  // Batch fetch all seasons for these titles (1 query)
  const allSeasons = await getSeasonsByTitleIds(tvTitleIds);

  const seasonIds = allSeasons.map((s) => s.id);

  // Batch fetch episodes actually available on Emby for these seasons (1
  // query) — episodes never downloaded (e.g. awaiting a French release)
  // don't count toward progress and can't be picked as the next episode,
  // so there's no need to load them here.
  const allEpisodes = await getOwnedEpisodesBySeasonIds(seasonIds);

  // Batch fetch all watches for this user for these episodes (1 query)
  const episodeIds = allEpisodes.map((ep) => ep.id);
  const rawWatches = await getEpisodeWatchesByEpisodeIds(userId, episodeIds);

  // Only count watches from each title's *current* rewatch cycle — a watch
  // left over from a previous watch-through shouldn't make a rewatch look
  // already caught up.
  const seasonToTitle = new Map(allSeasons.map((s) => [s.id, s.titleId]));
  const episodeToTitle = new Map(allEpisodes.map((ep) => [ep.id, seasonToTitle.get(ep.seasonId)]));
  const titleCycle = new Map(inProgress.map((r) => [r.titleId, r.currentCycle]));
  const allWatches = rawWatches.filter(
    (w) => w.cycle === (titleCycle.get(episodeToTitle.get(w.episodeId) ?? "") ?? 1),
  );

  // Build lookup maps
  const watchedEpisodeIds = new Set(allWatches.map((w) => w.episodeId));
  const watchDateMap = new Map<string, Date>();
  for (const watch of allWatches) {
    const existing = watchDateMap.get(watch.episodeId);
    if (!existing || watch.watchedAt > existing) {
      watchDateMap.set(watch.episodeId, watch.watchedAt);
    }
  }

  // Group seasons by title
  const seasonsByTitle = new Map<string, typeof allSeasons>();
  for (const s of allSeasons) {
    const arr = seasonsByTitle.get(s.titleId) ?? [];
    arr.push(s);
    seasonsByTitle.set(s.titleId, arr);
  }

  // Group episodes by season
  const episodesBySeason = new Map<string, typeof allEpisodes>();
  for (const ep of allEpisodes) {
    const arr = episodesBySeason.get(ep.seasonId) ?? [];
    arr.push(ep);
    episodesBySeason.set(ep.seasonId, arr);
  }

  const items: ContinueWatchingItem[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const row of inProgress) {
    const title = titleMap.get(row.titleId);
    if (!title) continue;

    const titleSeasonsArr = seasonsByTitle.get(title.id) ?? [];
    let nextEpisode: ContinueWatchingItem["nextEpisode"] = null;
    let lastWatchedAt: Date | null = null;
    let lastAiredAt: Date | null = null;
    let totalEpisodes = 0;
    let watchedEpisodes = 0;

    for (const s of titleSeasonsArr) {
      const eps = episodesBySeason.get(s.id) ?? [];
      totalEpisodes += eps.length;

      for (const ep of eps) {
        if (ep.airDate && ep.airDate <= today) {
          const airedDate = new Date(`${ep.airDate}T00:00:00`);
          if (!lastAiredAt || airedDate > lastAiredAt) {
            lastAiredAt = airedDate;
          }
        }
        if (watchedEpisodeIds.has(ep.id)) {
          watchedEpisodes++;
          const watchDate = watchDateMap.get(ep.id);
          if (watchDate && (!lastWatchedAt || watchDate > lastWatchedAt)) {
            lastWatchedAt = watchDate;
          }
        } else if (!nextEpisode) {
          // Skip episodes not yet aired
          if (ep.airDate && ep.airDate > today) continue;
          nextEpisode = {
            id: ep.id,
            seasonNumber: s.seasonNumber,
            episodeNumber: ep.episodeNumber,
            name: ep.name,
            stillPath: ep.stillPath,
            stillThumbHash: ep.stillThumbHash,
            overview: ep.overview,
            embyItemId: ep.embyItemId,
          };
        }
      }
    }

    if (nextEpisode) {
      items.push({
        title: {
          id: title.id,
          title: title.title,
          posterPath: title.posterPath,
          posterThumbHash: title.posterThumbHash,
          backdropPath: title.backdropPath,
          backdropThumbHash: title.backdropThumbHash,
          type: title.type,
          firstAirDate: title.firstAirDate,
          status: title.status,
          voteAverage: title.voteAverage,
          inEmbyLibrary: title.inEmbyLibrary,
          embyItemId: title.embyItemId,
        },
        nextEpisode,
        lastWatchedAt,
        lastAiredAt,
        totalEpisodes,
        watchedEpisodes,
      });
    }
  }

  items.sort((a, b) => {
    const field = sortBy === "aired" ? "lastAiredAt" : "lastWatchedAt";
    const aTime = a[field]?.getTime() ?? 0;
    const bTime = b[field]?.getTime() ?? 0;
    return sortDirection === "asc" ? aTime - bTime : bTime - aTime;
  });

  return items;
}

export { getNewAvailableFeed } from "@sofa/db/queries/discovery";

// Recency-capped: a user with a large library can have thousands of
// engaged/rated titles, and every one of them multiplies out into the
// titleRecommendations scan below (each title carries ~80-90 rows). Capping
// to the most recent ones keeps that scan bounded — recently watched/rated
// titles are also the more relevant taste signal anyway, so this isn't a
// quality tradeoff, just dropping a very long tail that barely moved the
// final top-20 in practice.
const RECOMMENDATION_SOURCE_LIMIT = 200;

export async function getRecommendationsFeed(userId: string, type?: "movie" | "tv") {
  // Get recommendations from user's highly-rated or completed titles
  const [userCompletedOrRated, ratedIds] = await Promise.all([
    getEngagedTitleIds(userId, RECOMMENDATION_SOURCE_LIMIT),
    getHighlyRatedTitleIds(userId, RECOMMENDATION_SOURCE_LIMIT),
  ]);

  const sourceIds = [...new Set([...userCompletedOrRated, ...ratedIds])];
  if (sourceIds.length === 0) return [];

  // Get all tracked title IDs to exclude
  const trackedIds = await getAllTrackedTitleIds(userId);

  // Aggregate + rank in SQL — see getTopRecommendationRows for why. `type`
  // filters in the same SQL pass so a type-scoped cap of 20 doesn't get
  // skewed empty by the other type dominating the global top-20 (24.08).
  const sorted = await getTopRecommendationRows(sourceIds, trackedIds, 20, type);

  if (sorted.length === 0) return [];

  // Batch fetch all recommended titles (1 query)
  const recTitleIds = sorted.map((r) => r.recommendedTitleId);
  const recTitles = await getTitlesByIds(recTitleIds);
  const recTitleMap = new Map(recTitles.map((t) => [t.id, t]));

  return sorted.map((r) => recTitleMap.get(r.recommendedTitleId)).filter(Boolean);
}

// ─── Upcoming feed ──────────────────────────────────────────────────

export interface UpcomingItem {
  episodeId: string | null;
  titleId: string;
  titleName: string;
  titleType: "movie" | "tv";
  posterPath: string | null;
  posterThumbHash: string | null;
  backdropPath: string | null;
  backdropThumbHash: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  episodeName: string | null;
  episodeCount: number;
  date: string;
  userStatus: DisplayStatus;
  isNewSeason: boolean;
  streamingProvider: {
    platformId: string;
    providerName: string;
    logoPath: string | null;
  } | null;
}

export interface UpcomingFeedResult {
  items: UpcomingItem[];
  nextCursor: string | null;
  totalResults: number;
}

export async function getUpcomingFeed(
  userId: string,
  options: {
    days?: number;
    limit?: number;
    cursor?: string;
    mediaType?: "movie" | "tv";
    statusFilter?: ("watching" | "watchlist")[];
  } = {},
): Promise<UpcomingFeedResult> {
  const { days = 90, limit = 20, cursor, mediaType, statusFilter } = options;

  // Map display status filter to stored statuses for DB query
  const storedStatuses = statusFilter?.map((s) => (s === "watching" ? "in_progress" : s));

  const now = new Date();
  const today = formatLocalDate(now);
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + days);
  const toDate = formatLocalDate(horizon);

  // Use the cursor date as the lower bound so later pages skip already-seen dates,
  // but don't apply a DB-level LIMIT so same-day items aren't truncated.
  let cursorDate: string | undefined;
  let cursorName: string | undefined;
  let cursorId: string | undefined;
  if (cursor) {
    try {
      const parsed = JSON.parse(atob(cursor));
      cursorDate = parsed.d;
      cursorName = parsed.n;
      cursorId = parsed.i;
    } catch {
      // Invalid cursor — ignore
    }
  }
  const fromDate = cursorDate ?? today;
  const episodeRows =
    mediaType === "movie" ? [] : await getUpcomingEpisodes(userId, fromDate, toDate, storedStatuses);
  const movieRows =
    mediaType === "tv" ? [] : await getUpcomingMovies(userId, fromDate, toDate, storedStatuses);

  // Merge into unified items
  type RawItem = { date: string; titleId: string; titleName: string } & (
    | { type: "tv"; row: (typeof episodeRows)[number] }
    | { type: "movie"; row: (typeof movieRows)[number] }
  );

  const merged: RawItem[] = [
    ...episodeRows.map((r) => ({
      date: r.airDate!,
      titleId: r.titleId,
      titleName: r.titleName,
      type: "tv" as const,
      row: r,
    })),
    ...movieRows.map((r) => ({
      date: r.releaseDate!,
      titleId: r.titleId,
      titleName: r.titleName,
      type: "movie" as const,
      row: r,
    })),
  ];

  // Sort by date ASC, then title ASC, then titleId for deterministic tiebreak
  merged.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.titleName.localeCompare(b.titleName) ||
      a.titleId.localeCompare(b.titleId),
  );

  // Collapse batch drops: group 3+ episodes from the same title on the same date into one item
  const collapsed: (RawItem & { episodeCount: number })[] = [];
  let i = 0;
  while (i < merged.length) {
    const current = merged[i]!;
    if (current.type === "tv") {
      // Count consecutive episodes with the same (titleId, date)
      let groupEnd = i + 1;
      while (
        groupEnd < merged.length &&
        merged[groupEnd]!.type === "tv" &&
        merged[groupEnd]!.titleId === current.titleId &&
        merged[groupEnd]!.date === current.date
      ) {
        groupEnd++;
      }
      const groupSize = groupEnd - i;
      if (groupSize >= 3) {
        // Collapse: keep first item with episodeCount and clear episode name
        collapsed.push({ ...current, episodeCount: groupSize });
        i = groupEnd;
      } else {
        // Keep individual items
        for (let j = i; j < groupEnd; j++) {
          collapsed.push({ ...merged[j]!, episodeCount: 1 });
        }
        i = groupEnd;
      }
    } else {
      collapsed.push({ ...current, episodeCount: 1 });
      i++;
    }
  }

  // Apply cursor: skip items at or before the cursor position.
  // Cursor is base64-encoded JSON {d, n, i} matching the sort key (date, titleName, titleId).
  let startIdx = 0;
  if (cursorDate && cursorName && cursorId) {
    startIdx = collapsed.findIndex(
      (item) =>
        item.date > cursorDate ||
        (item.date === cursorDate && item.titleName > cursorName) ||
        (item.date === cursorDate && item.titleName === cursorName && item.titleId > cursorId),
    );
    if (startIdx === -1) startIdx = collapsed.length;
  }

  const pageItems = collapsed.slice(startIdx, startIdx + limit);
  const hasMore = startIdx + limit < collapsed.length;

  // Compute cursor from the last item on this page
  let nextCursor: string | null = null;
  if (hasMore && pageItems.length > 0) {
    const last = pageItems.at(-1)!;
    nextCursor = btoa(JSON.stringify({ d: last.date, n: last.titleName, i: last.titleId }));
  }

  // Batch-fetch display statuses and streaming providers
  const titleIds = [...new Set(pageItems.map((item) => item.titleId))];
  const [displayStatuses, providerRows] = await Promise.all([
    getDisplayStatusesByTitleIds(userId, titleIds),
    getAvailabilityByTitleIds(titleIds),
  ]);
  const providerMap = new Map<
    string,
    { platformId: string; providerName: string; logoPath: string | null }
  >();
  for (const p of providerRows) {
    if (!providerMap.has(p.titleId)) {
      providerMap.set(p.titleId, {
        platformId: p.platformId,
        providerName: p.providerName,
        logoPath: p.logoPath,
      });
    }
  }

  const items: UpcomingItem[] = pageItems.map((item) => {
    if (item.type === "tv") {
      const r = item.row;
      const isCollapsed = item.episodeCount > 1;
      return {
        episodeId: isCollapsed ? null : r.episodeId,
        titleId: r.titleId,
        titleName: r.titleName,
        titleType: "tv",
        posterPath: r.posterPath,
        posterThumbHash: r.posterThumbHash,
        backdropPath: r.backdropPath ?? null,
        backdropThumbHash: r.backdropThumbHash ?? null,
        seasonNumber: r.seasonNumber,
        episodeNumber: r.episodeNumber,
        episodeName: isCollapsed ? null : r.episodeName,
        episodeCount: item.episodeCount,
        date: r.airDate!,
        userStatus: displayStatuses[r.titleId] ?? "watching",
        isNewSeason:
          (displayStatuses[r.titleId] === "caught_up" ||
            displayStatuses[r.titleId] === "completed") &&
          r.episodeNumber === 1,
        streamingProvider: providerMap.get(r.titleId) ?? null,
      };
    }
    const r = item.row;
    return {
      episodeId: null,
      titleId: r.titleId,
      titleName: r.titleName,
      titleType: "movie",
      posterPath: r.posterPath,
      posterThumbHash: r.posterThumbHash,
      backdropPath: r.backdropPath ?? null,
      backdropThumbHash: r.backdropThumbHash ?? null,
      seasonNumber: null,
      episodeNumber: null,
      episodeName: null,
      episodeCount: 1,
      date: r.releaseDate!,
      userStatus: displayStatuses[r.titleId] ?? "in_watchlist",
      isNewSeason: false,
      streamingProvider: providerMap.get(r.titleId) ?? null,
    };
  });

  // 26.08, Sid — collapsed already holds every upcoming item in the date
  // window (no DB-level LIMIT, see comment above) before the cursor slice,
  // so its length is the real total — UpcomingCardsSection was showing
  // items.length (capped at `limit`) as if it were that total.
  return { items, nextCursor, totalResults: collapsed.length };
}

export async function getUntrackedEmbyLibraryFeed(
  userId: string,
  limit = 20,
  type?: "movie" | "tv",
) {
  const titleIds = await getUntrackedEmbyLibraryTitleIds(userId, limit, type);
  if (titleIds.length === 0) return [];

  const titleRows = await getTitlesByIds(titleIds);
  const titleMap = new Map(titleRows.map((t) => [t.id, t]));

  // Preserve the original ordering (most recently scanned first)
  return titleIds
    .map((id) => titleMap.get(id))
    .filter((t): t is NonNullable<typeof t> => t != null)
    .map((t) => ({
      id: t.id,
      tmdbId: t.tmdbId,
      type: t.type as "movie" | "tv",
      title: t.title,
      posterPath: t.posterPath,
      posterThumbHash: t.posterThumbHash,
      releaseDate: t.releaseDate,
      firstAirDate: t.firstAirDate,
      voteAverage: t.voteAverage,
      embyLibraryName: t.embyLibraryName,
    }));
}

export async function getRecommendationsForTitle(titleId: string) {
  const [title] = await getTitleByIdOrNull(titleId);
  if (!title) return [];

  const recs = await getRecommendationRowsForTitle(titleId);

  if (recs.length === 0) return [];

  const sourcePriority = {
    tmdb_recommendations: 0,
    tmdb_similar: 1,
  } as const;
  const orderedRecs = recs.toSorted(
    (a, b) => a.rank - b.rank || sourcePriority[a.source] - sourcePriority[b.source],
  );

  const seenRecommendedTitleIds = new Set<string>();
  const uniqueRecs = orderedRecs.filter((rec) => {
    if (seenRecommendedTitleIds.has(rec.recommendedTitleId)) {
      return false;
    }
    seenRecommendedTitleIds.add(rec.recommendedTitleId);
    return true;
  });

  // Batch fetch all recommended titles (1 query)
  const recTitleIds = uniqueRecs.map((r) => r.recommendedTitleId);
  const recTitles = await getTitlesByIds(recTitleIds);
  const recTitleMap = new Map(recTitles.map((t) => [t.id, t]));

  return uniqueRecs
    .map((rec) => {
      const r = recTitleMap.get(rec.recommendedTitleId);
      if (!r) return null;
      return {
        id: r.id,
        tmdbId: r.tmdbId,
        type: r.type as "movie" | "tv",
        title: r.title,
        posterPath: tmdbImageUrl(r.posterPath, "posters"),
        posterThumbHash: r.posterThumbHash,
        releaseDate: r.releaseDate,
        firstAirDate: r.firstAirDate,
        voteAverage: r.voteAverage,
      };
    })
    // 25.08, Sid: "au moins des années 2000" — same year floor as the
    // personalized recommendations feed (getTopRecommendationRows), applied
    // here too since this is the OTHER place recommendations show up (the
    // "Recommended" section under a title's own page).
    .filter(
      (r): r is NonNullable<typeof r> =>
        r !== null &&
        ((r.releaseDate ?? "") >= RECOMMENDATION_MIN_YEAR ||
          (r.firstAirDate ?? "") >= RECOMMENDATION_MIN_YEAR),
    );
}
