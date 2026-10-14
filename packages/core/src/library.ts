import { getMovieWatchCountsByTitleIds } from "@sofa/db/queries/discovery";
import { deriveEmbyStatus } from "@sofa/db/queries/emby-library";
import {
  getFilteredLibrary,
  getLibraryGenres,
  type LibraryFilters,
} from "@sofa/db/queries/library";

import {
  getDisplayStatusesByTitleIds,
  getEpisodeProgressByTitleIds,
  getTvRewatchCountsByTitleIds,
} from "./tracking";

export type { LibraryFilters };

export async function getFilteredLibraryFeed(userId: string, filters: LibraryFilters) {
  const result = await getFilteredLibrary(userId, filters);

  const titleIds = result.items.map((i) => i.titleId);
  const displayStatuses = await getDisplayStatusesByTitleIds(userId, titleIds);
  const episodeProgress = await getEpisodeProgressByTitleIds(userId, titleIds);
  const movieWatchCounts = await getMovieWatchCountsByTitleIds(userId, titleIds);
  const tvRewatchCounts = await getTvRewatchCountsByTitleIds(userId, titleIds);

  return {
    items: result.items.map((item) => ({
      titleId: item.titleId,
      title: item.title,
      type: item.type,
      tmdbId: item.tmdbId,
      posterPath: item.posterPath,
      posterThumbHash: item.posterThumbHash,
      releaseDate: item.releaseDate,
      firstAirDate: item.firstAirDate,
      status: item.status,
      voteAverage: item.voteAverage,
      embyStatus: deriveEmbyStatus(item.inEmbyLibrary, item.embyItemId),
      embyItemId: item.embyItemId,
      userStatus: displayStatuses[item.titleId] ?? null,
      userRating: item.userRating ?? null,
      episodeProgress: episodeProgress[item.titleId] ?? null,
      watchCount:
        item.type === "movie"
          ? (movieWatchCounts.get(item.titleId) ?? 0)
          : (tvRewatchCounts.get(item.titleId) ?? 0),
    })),
    page: result.page,
    totalPages: result.totalPages,
    totalResults: result.totalResults,
  };
}

// 19.09, Sid: "comment on peut aider cette ouverture à froid ?" — this is
// consistently the FIRST slow call logged whenever the library page's cold
// open freezes the server (14-35s+ in prod), even though the query itself
// is fast in isolation (190ms measured live against Sid's own 3008-title
// account) — the real cost is a burst of concurrent requests all landing on
// bun:sqlite's single synchronous thread at once. A user's genre list only
// changes when a title is added/removed from their library or a new genre
// is imported — both rare — so a short TTL cache removes this call from
// the cold-open burst entirely on every repeat open within the window,
// at the cost of up to GENRES_CACHE_TTL_MS of staleness (a filter
// dropdown, not something that needs to be instant). Same simple
// module-level-Map pattern as `cachedToken` in books.ts, deliberately kept
// time-based only (no write-site invalidation) to avoid missing one of the
// several places userTitleStatus/titleGenres can change.
const GENRES_CACHE_TTL_MS = 10 * 60_000;
const genresCache = new Map<
  string,
  { data: Awaited<ReturnType<typeof getLibraryGenres>>; expiresAt: number }
>();

export async function getLibraryGenresList(userId: string) {
  const cached = genresCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }
  const data = await getLibraryGenres(userId);
  genresCache.set(userId, { data, expiresAt: Date.now() + GENRES_CACHE_TTL_MS });
  return data;
}
