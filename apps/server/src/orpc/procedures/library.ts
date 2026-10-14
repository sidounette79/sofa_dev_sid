import {
  getContinueWatchingFeed,
  getLibraryStatistics,
  getUserStats,
  getUpcomingFeed,
} from "@sofa/core/discovery";
import { getFilteredLibraryFeed, getLibraryGenresList } from "@sofa/core/library";
import { getEmbyPublicUrl, getEmbyServerId, resolvePosterUrl } from "@sofa/core/emby";
import { getNowPlayingFeed } from "@sofa/core/now-playing";
import { getTvRewatchCountsByTitleIds } from "@sofa/core/tracking";
import { deriveEmbyStatus } from "@sofa/db/queries/emby-library";
import { tmdbImageUrl } from "@sofa/tmdb/image";

import { os } from "../context";
import { authed } from "../middleware";

export const list = os.library.list.use(authed).handler(async ({ input, context }) => {
  const result = await getFilteredLibraryFeed(context.user.id, {
    search: input.search,
    statuses: input.statuses,
    type: input.type,
    genreId: input.genreId,
    ratingMin: input.ratingMin,
    ratingMax: input.ratingMax,
    yearMin: input.yearMin,
    yearMax: input.yearMax,
    contentRating: input.contentRating,
    onMyServices: input.onMyServices,
    sortBy: input.sortBy,
    sortDirection: input.sortDirection,
    page: input.page,
    limit: input.limit,
  });

  return {
    items: result.items.map((item) => ({
      id: item.titleId,
      tmdbId: item.tmdbId,
      type: item.type,
      title: item.title,
      posterPath: resolvePosterUrl(tmdbImageUrl(item.posterPath, "posters"), item.embyItemId),
      posterThumbHash: item.posterThumbHash ?? null,
      releaseDate: item.releaseDate ?? null,
      firstAirDate: item.firstAirDate ?? null,
      status: item.status ?? null,
      voteAverage: item.voteAverage,
      embyStatus: item.embyStatus,
      userStatus: item.userStatus,
      userRating: item.userRating,
      episodeProgress: item.episodeProgress,
      watchCount: item.watchCount,
    })),
    page: result.page,
    totalPages: result.totalPages,
    totalResults: result.totalResults,
  };
});

export const genres = os.library.genres.use(authed).handler(async ({ context }) => {
  return { genres: await getLibraryGenresList(context.user.id) };
});

export const stats = os.library.stats.use(authed).handler(async ({ context }) => {
  const userStats = await getUserStats(context.user.id);
  return { size: userStats.librarySize, completed: userStats.completed };
});
export const statistics = os.library.statistics.use(authed).handler(({ context }) => {
  return getLibraryStatistics(context.user.id);
});

export const continueWatching = os.library.continueWatching
  .use(authed)
  .handler(async ({ input, context }) => {
    const feed = await getContinueWatchingFeed(context.user.id, input.sortBy, input.sortDirection);
    const rewatchCounts = await getTvRewatchCountsByTitleIds(
      context.user.id,
      feed.map((item) => item.title.id),
    );
    const items = feed.map((item) => ({
      title: {
        id: item.title.id,
        title: item.title.title,
        type: item.title.type,
        posterPath: resolvePosterUrl(
          tmdbImageUrl(item.title.posterPath, "posters"),
          item.title.embyItemId,
        ),
        posterThumbHash: item.title.posterThumbHash,
        backdropPath: tmdbImageUrl(item.title.backdropPath, "backdrops"),
        backdropThumbHash: item.title.backdropThumbHash,
        firstAirDate: item.title.firstAirDate,
        status: item.title.status,
        voteAverage: item.title.voteAverage,
        embyStatus: deriveEmbyStatus(item.title.inEmbyLibrary, item.title.embyItemId),
        watchCount: rewatchCounts.get(item.title.id) ?? 0,
      },
      nextEpisode: item.nextEpisode
        ? {
            seasonNumber: item.nextEpisode.seasonNumber,
            episodeNumber: item.nextEpisode.episodeNumber,
            name: item.nextEpisode.name,
            stillPath: tmdbImageUrl(item.nextEpisode.stillPath, "stills"),
            stillThumbHash: item.nextEpisode.stillThumbHash,
            embyItemId: item.nextEpisode.embyItemId,
          }
        : null,
      totalEpisodes: item.totalEpisodes,
      watchedEpisodes: item.watchedEpisodes,
      lastWatchedAt: item.lastWatchedAt?.toISOString() ?? null,
      lastAiredAt: item.lastAiredAt?.toISOString() ?? null,
    }));
    const embyServerId = await getEmbyServerId();
    return { items, embyServerId, embyUrl: getEmbyPublicUrl() };
  });

export const nowPlaying = os.library.nowPlaying.use(authed).handler(async ({ context }) => {
  const items = await getNowPlayingFeed(context.user.id);
  return { items };
});

export const upcoming = os.library.upcoming.use(authed).handler(async ({ input, context }) => {
  const result = await getUpcomingFeed(context.user.id, {
    days: input.days,
    limit: input.limit,
    cursor: input.cursor,
    mediaType: input.mediaType,
    statusFilter: input.statusFilter,
  });
  return {
    items: result.items.map((item) => ({
      ...item,
      posterPath: tmdbImageUrl(item.posterPath, "posters"),
      backdropPath: tmdbImageUrl(item.backdropPath, "backdrops"),
      streamingProvider: item.streamingProvider
        ? {
            ...item.streamingProvider,
            logoPath: tmdbImageUrl(item.streamingProvider.logoPath, "logos"),
          }
        : null,
    })),
    nextCursor: result.nextCursor,
    totalResults: result.totalResults,
  };
});
