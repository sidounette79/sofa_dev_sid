import { ORPCError } from "@orpc/server";

import { AppErrorCode } from "@sofa/api/errors";
import { WATCH_REGION } from "@sofa/config";
import { getRecommendationsFeed, getUntrackedEmbyLibraryFeed } from "@sofa/core/discovery";
import { ensureBrowseTitlesExist } from "@sofa/core/metadata";
import { ensureBrowsePersonsExist } from "@sofa/core/person";
import { getPlatformTmdbIdMap, getPlatformTmdbIds, listPlatforms } from "@sofa/core/platforms";
import { getDisplayStatusesByTitleIds, getEpisodeProgressByTitleIds } from "@sofa/core/tracking";
import { getEmbyStatusByTitleIds, getRequestedAtByTitleIds } from "@sofa/db/queries/discovery";
import { deriveEmbyStatus, getUntrackedEmbyLibraryCount } from "@sofa/db/queries/emby-library";
import { getRequestedNotAvailable } from "@sofa/db/queries/title";
import {
  discover as discoverTmdb,
  getGenres,
  getPopular,
  getTrending,
  getUpcomingMovies,
  searchMovies,
  searchMulti,
  searchPerson,
  searchTv,
} from "@sofa/tmdb/client";
import { isTmdbConfigured } from "@sofa/tmdb/config";
import { tmdbImageUrl } from "@sofa/tmdb/image";

import { os } from "../context";
import { authed } from "../middleware";

function requireTmdb() {
  if (!isTmdbConfigured()) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "TMDB API key is not configured",
      data: { code: AppErrorCode.TMDB_NOT_CONFIGURED },
    });
  }
}

// ─── Trending ─────────────────────────────────────────────────

// Genre 16 = Animation in TMDB's genre list. Animation alone also covers
// Pixar/Disney/etc — anime specifically (24.08, Sid: "pas d'anime" in
// Trending) is Animation genre AND Japanese original language, the same
// heuristic most trackers use.
const ANIME_GENRE_ID = 16;
function isAnime(r: Record<string, unknown>): boolean {
  const genreIds = (r.genre_ids as number[] | undefined) ?? [];
  return genreIds.includes(ANIME_GENRE_ID) && r.original_language === "ja";
}

// TV genre IDs: Talk (10767), News (10763), Reality (10764). Excluded from
// discovery unless French (24.08, Sid: "masquer les talk shows et les
// journaux TV et la télé-réalité hors France") — she watches none of the US
// ones (see project_sofa_trakt_phantom_titles memory, same pattern as the
// 17 phantom talk-show titles found earlier this project).
const JUNK_TV_GENRE_IDS = [10767, 10763, 10764];
function isJunkNonFrenchTv(r: Record<string, unknown>): boolean {
  const genreIds = (r.genre_ids as number[] | undefined) ?? [];
  if (!genreIds.some((g) => JUNK_TV_GENRE_IDS.includes(g))) return false;
  return r.original_language !== "fr";
}

/** Combined discovery-noise filter — anime + non-French talk/news/reality. */
function isDiscoveryNoise(r: Record<string, unknown>): boolean {
  return isAnime(r) || isJunkNonFrenchTv(r);
}

// 06.09, Sid: "masquer ce qui est déjà vu" — already-in-Emby was excluded
// everywhere below, but something watched via another means (an old Trakt
// import, since removed from Emby) has embyStatus null/removed while its
// userStatus is still completed/caught_up, so it kept surfacing.
// 17.10, Sid: reversed — "ne plus masquer dans découvrir les films qu'on a
// déjà en stock ou ceux qu'on a déjà vu, tout laisser apparaître dans toute
// la page découvrir". The filter this function drove is gone from every
// call site below (trending/popular/upcomingMovies/upcomingSeries/browse);
// removed rather than left dead, since nothing calls it anymore.

export const trending = os.discover.trending.use(authed).handler(async ({ input, context }) => {
  requireTmdb();

  const data = await getTrending(input.type, input.timeWindow, input.page);
  const rawResults = (data.results ?? []) as Record<string, unknown>[];
  const results = rawResults.filter((r) => !isDiscoveryNoise(r));

  const baseItems = results
    .filter((r) => r.poster_path)
    .map((r) => {
      const mediaType = r.media_type === "movie" || r.media_type === "tv" ? r.media_type : "movie";
      return {
        tmdbId: r.id as number,
        type: mediaType as "movie" | "tv",
        title: ((r.title ?? r.name) as string) || "",
        posterPath: (r.poster_path as string) ?? null,
        releaseDate: (r.release_date as string | undefined) ?? null,
        firstAirDate: (r.first_air_date as string | undefined) ?? null,
        voteAverage: (r.vote_average as number | undefined) ?? null,
      };
    });
  const heroResult = results.find(
    (r) => r.backdrop_path && (r.media_type === "movie" || r.media_type === "tv"),
  );

  const allBrowseItems = [
    ...baseItems,
    ...(heroResult
      ? [
          {
            tmdbId: heroResult.id as number,
            type: heroResult.media_type as "movie" | "tv",
            title: ((heroResult.title ?? heroResult.name) as string | undefined) ?? "",
            posterPath: (heroResult.poster_path as string) ?? null,
            releaseDate: (heroResult.release_date as string | undefined) ?? null,
            firstAirDate: (heroResult.first_air_date as string | undefined) ?? null,
            voteAverage: (heroResult.vote_average as number | undefined) ?? null,
          },
        ]
      : []),
  ];
  const titleMap = await ensureBrowseTitlesExist(allBrowseItems);

  const items = baseItems.map((item) => {
    const entry = titleMap.get(`${item.tmdbId}-${item.type}`);
    return Object.assign(item, {
      id: entry?.id ?? "",
      posterPath: tmdbImageUrl(item.posterPath, "posters"),
      posterThumbHash: entry?.posterThumbHash ?? null,
    });
  });

  const heroEntry = heroResult
    ? titleMap.get(`${heroResult.id as number}-${heroResult.media_type as string}`)
    : undefined;
  const hero = heroResult
    ? {
        id: heroEntry?.id ?? "",
        tmdbId: heroResult.id as number,
        type: heroResult.media_type as "movie" | "tv",
        title: ((heroResult.title ?? heroResult.name) as string | undefined) ?? "",
        overview: (heroResult.overview as string | undefined) ?? "",
        backdropPath: tmdbImageUrl((heroResult.backdrop_path as string) ?? null, "backdrops"),
        voteAverage: heroResult.vote_average as number,
      }
    : null;

  const titleIds = items.map((r) => r.id);
  const [userStatuses, episodeProgress, embyStatusMap, requestedAtMap] =
    titleIds.length > 0
      ? await Promise.all([
          getDisplayStatusesByTitleIds(context.user.id, titleIds),
          getEpisodeProgressByTitleIds(context.user.id, titleIds),
          getEmbyStatusByTitleIds(titleIds),
          getRequestedAtByTitleIds(titleIds),
        ])
      : [{}, {}, {}, {}];

  const itemsWithEmby = items.map((item) => {
    const emby = embyStatusMap[item.id];
    return {
      ...item,
      embyStatus: emby ? deriveEmbyStatus(emby.inEmbyLibrary, emby.embyItemId) : null,
      // Household-wide, not scoped to the current user — see
      // getRequestedAtByTitleIds's own doc comment.
      requestedAt: requestedAtMap[item.id] ?? null,
    };
  });

  // 17.10, Sid: "ne plus masquer dans découvrir les films qu'on a déjà en
  // stock ou ceux qu'on a déjà vu" — reverses the 24.08 "filtrer ce qu'on a
  // déjà" behaviour (see the removed isDiscoverable helper, used to sit
  // just above). Cap each type separately so the row stops perpetually
  // loading more pages to fill the screen.
  const TRENDING_CAP_PER_TYPE = 30;
  const notOwned = itemsWithEmby;
  const cappedMovies = notOwned
    .filter((item) => item.type === "movie")
    .slice(0, TRENDING_CAP_PER_TYPE);
  const cappedTv = notOwned.filter((item) => item.type === "tv").slice(0, TRENDING_CAP_PER_TYPE);
  const cappedItems = notOwned.filter(
    (item) => cappedMovies.includes(item) || cappedTv.includes(item),
  );

  return {
    items: cappedItems,
    hero,
    userStatuses,
    episodeProgress,
    page: (data as { page?: number }).page ?? input.page,
    // Hardcoded to 1 (not TMDB's real total_pages) — Trending is capped to a
    // single page + a per-type limit now, not meant to paginate further.
    // Fixes the "loads perpetually" complaint: the client's infinite-scroll
    // sentinel kept firing because TMDB's own total_pages is in the
    // thousands.
    totalPages: 1,
    totalResults: cappedItems.length,
  };
});

// ─── Popular ──────────────────────────────────────────────────

export const popular = os.discover.popular.use(authed).handler(async ({ input, context }) => {
  requireTmdb();

  const data = await getPopular(input.type, input.page);
  const baseItems = ((data.results ?? []) as Record<string, unknown>[])
    .filter((r) => r.poster_path && !isDiscoveryNoise(r))
    .map((r) => ({
      tmdbId: r.id as number,
      type: input.type,
      title: ((r.title ?? r.name) as string) || "",
      posterPath: (r.poster_path as string) ?? null,
      releaseDate: (r.release_date as string | undefined) ?? null,
      firstAirDate: (r.first_air_date as string | undefined) ?? null,
      voteAverage: (r.vote_average as number | undefined) ?? null,
    }));

  const titleMap = await ensureBrowseTitlesExist(baseItems);
  const items = baseItems.map((item) => {
    const entry = titleMap.get(`${item.tmdbId}-${item.type}`);
    return Object.assign(item, {
      id: entry?.id ?? "",
      posterPath: tmdbImageUrl(item.posterPath, "posters"),
      posterThumbHash: entry?.posterThumbHash ?? null,
    });
  });

  const titleIds = items.map((r) => r.id);
  const [userStatuses, episodeProgress, embyStatusMap, requestedAtMap] =
    titleIds.length > 0
      ? await Promise.all([
          getDisplayStatusesByTitleIds(context.user.id, titleIds),
          getEpisodeProgressByTitleIds(context.user.id, titleIds),
          getEmbyStatusByTitleIds(titleIds),
          getRequestedAtByTitleIds(titleIds),
        ])
      : [{}, {}, {}, {}];

  const itemsWithEmby = items.map((item) => {
    const emby = embyStatusMap[item.id];
    return {
      ...item,
      embyStatus: emby ? deriveEmbyStatus(emby.inEmbyLibrary, emby.embyItemId) : null,
      // Household-wide, not scoped to the current user — see
      // getRequestedAtByTitleIds's own doc comment.
      requestedAt: requestedAtMap[item.id] ?? null,
    };
  });

  // Same cap as Trending; the "already-owned" filter was dropped 17.10
  // (Sid: "ne plus masquer dans découvrir" — see trending's own comment).
  const POPULAR_CAP = 30;
  const cappedItems = itemsWithEmby.slice(0, POPULAR_CAP);

  return {
    items: cappedItems,
    userStatuses,
    episodeProgress,
    page: data.page ?? input.page,
    totalPages: 1,
    totalResults: cappedItems.length,
  };
});

// ─── Top Movies of the Year ─────────────────────────────────────

export const topMoviesOfYear = os.discover.topMoviesOfYear
  .use(authed)
  .handler(async ({ context }) => {
    requireTmdb();

    // 17.10, Sid: "les tops films de 2026 (qui changeront en 2027 etc)" —
    // derived from the real calendar year, not stored/configured anywhere,
    // so this row advances on its own every January with no deploy needed.
    const year = new Date().getFullYear();
    // Same vote_count.gte=50 quality floor as DiscoverSection's own default
    // sort (see browse, below) — without it, a handful of barely-voted
    // obscure titles with a lucky 10/10 average would crowd out anything
    // TMDB users have actually rated at scale.
    const data = await discoverTmdb(
      "movie",
      {
        sort_by: "vote_average.desc",
        primary_release_year: String(year),
        "vote_count.gte": "50",
      },
      1,
    );
    const baseItems = ((data.results ?? []) as Record<string, unknown>[])
      .filter((r) => r.poster_path && !isDiscoveryNoise(r))
      .map((r) => ({
        tmdbId: r.id as number,
        type: "movie" as const,
        title: (r.title as string) || "",
        posterPath: (r.poster_path as string) ?? null,
        releaseDate: (r.release_date as string | undefined) ?? null,
        firstAirDate: null,
        voteAverage: (r.vote_average as number | undefined) ?? null,
      }));

    const titleMap = await ensureBrowseTitlesExist(baseItems);
    const items = baseItems.map((item) => {
      const entry = titleMap.get(`${item.tmdbId}-${item.type}`);
      return Object.assign(item, {
        id: entry?.id ?? "",
        posterPath: tmdbImageUrl(item.posterPath, "posters"),
        posterThumbHash: entry?.posterThumbHash ?? null,
      });
    });

    const titleIds = items.map((r) => r.id);
    const [userStatuses, episodeProgress, embyStatusMap, requestedAtMap] =
      titleIds.length > 0
        ? await Promise.all([
            getDisplayStatusesByTitleIds(context.user.id, titleIds),
            getEpisodeProgressByTitleIds(context.user.id, titleIds),
            getEmbyStatusByTitleIds(titleIds),
            getRequestedAtByTitleIds(titleIds),
          ])
        : [{}, {}, {}, {}];

    const itemsWithEmby = items.map((item) => {
      const emby = embyStatusMap[item.id];
      return Object.assign(item, {
        embyStatus: emby ? deriveEmbyStatus(emby.inEmbyLibrary, emby.embyItemId) : null,
        requestedAt: requestedAtMap[item.id] ?? null,
      });
    });

    const TOP_MOVIES_CAP = 30;
    const cappedItems = itemsWithEmby.slice(0, TOP_MOVIES_CAP);

    return {
      items: cappedItems,
      userStatuses,
      episodeProgress,
      page: 1,
      totalPages: 1,
      totalResults: cappedItems.length,
    };
  });

// ─── Upcoming Movies (discovery, not the tracked-library /upcoming) ────

export const upcomingMovies = os.discover.upcomingMovies
  .use(authed)
  .handler(async ({ input, context }) => {
    requireTmdb();

    const data = await getUpcomingMovies(input.page);
    const baseItems = ((data.results ?? []) as Record<string, unknown>[])
      .filter((r) => r.poster_path && !isDiscoveryNoise(r))
      .map((r) => ({
        tmdbId: r.id as number,
        type: "movie" as const,
        title: (r.title as string) || "",
        posterPath: (r.poster_path as string) ?? null,
        releaseDate: (r.release_date as string | undefined) ?? null,
        firstAirDate: null,
        voteAverage: (r.vote_average as number | undefined) ?? null,
      }));

    const titleMap = await ensureBrowseTitlesExist(baseItems);
    const items = baseItems.map((item) => {
      const entry = titleMap.get(`${item.tmdbId}-${item.type}`);
      return Object.assign(item, {
        id: entry?.id ?? "",
        posterPath: tmdbImageUrl(item.posterPath, "posters"),
        posterThumbHash: entry?.posterThumbHash ?? null,
      });
    });

    const titleIds = items.map((r) => r.id);
    const [userStatuses, episodeProgress, embyStatusMap, requestedAtMap] =
      titleIds.length > 0
        ? await Promise.all([
            getDisplayStatusesByTitleIds(context.user.id, titleIds),
            getEpisodeProgressByTitleIds(context.user.id, titleIds),
            getEmbyStatusByTitleIds(titleIds),
            getRequestedAtByTitleIds(titleIds),
          ])
        : [{}, {}, {}, {}];

    const itemsWithEmby = items.map((item) => {
      const emby = embyStatusMap[item.id];
      return {
        ...item,
        embyStatus: emby ? deriveEmbyStatus(emby.inEmbyLibrary, emby.embyItemId) : null,
        // Household-wide, not scoped to the current user — see
        // getRequestedAtByTitleIds's own doc comment.
        requestedAt: requestedAtMap[item.id] ?? null,
      };
    });

    // 17.10: "already-owned" filter dropped, see trending's own comment.
    const UPCOMING_MOVIES_CAP = 30;
    const cappedItems = itemsWithEmby.slice(0, UPCOMING_MOVIES_CAP);

    return {
      items: cappedItems,
      userStatuses,
      episodeProgress,
      page: data.page ?? input.page,
      totalPages: 1,
      totalResults: cappedItems.length,
    };
  });

// ─── Upcoming Series (discovery, not the tracked-library /upcoming) ───

export const upcomingSeries = os.discover.upcomingSeries
  .use(authed)
  .handler(async ({ input, context }) => {
    requireTmdb();

    // TMDB has no dedicated /tv/upcoming endpoint (unlike movies) — Discover
    // TV with a first_air_date floor of today is the equivalent.
    const today = new Date().toISOString().slice(0, 10);
    const data = await discoverTmdb(
      "tv",
      { "first_air_date.gte": today, sort_by: "popularity.desc", "vote_count.gte": "5" },
      input.page,
    );
    const baseItems = ((data.results ?? []) as Record<string, unknown>[])
      .filter((r) => r.poster_path && !isDiscoveryNoise(r))
      .map((r) => ({
        tmdbId: r.id as number,
        type: "tv" as const,
        title: (r.name as string) || "",
        posterPath: (r.poster_path as string) ?? null,
        releaseDate: null,
        firstAirDate: (r.first_air_date as string | undefined) ?? null,
        voteAverage: (r.vote_average as number | undefined) ?? null,
      }));

    const titleMap = await ensureBrowseTitlesExist(baseItems);
    const items = baseItems.map((item) => {
      const entry = titleMap.get(`${item.tmdbId}-${item.type}`);
      return Object.assign(item, {
        id: entry?.id ?? "",
        posterPath: tmdbImageUrl(item.posterPath, "posters"),
        posterThumbHash: entry?.posterThumbHash ?? null,
      });
    });

    const titleIds = items.map((r) => r.id);
    const [userStatuses, episodeProgress, embyStatusMap, requestedAtMap] =
      titleIds.length > 0
        ? await Promise.all([
            getDisplayStatusesByTitleIds(context.user.id, titleIds),
            getEpisodeProgressByTitleIds(context.user.id, titleIds),
            getEmbyStatusByTitleIds(titleIds),
            getRequestedAtByTitleIds(titleIds),
          ])
        : [{}, {}, {}, {}];

    const itemsWithEmby = items.map((item) => {
      const emby = embyStatusMap[item.id];
      return {
        ...item,
        embyStatus: emby ? deriveEmbyStatus(emby.inEmbyLibrary, emby.embyItemId) : null,
        // Household-wide, not scoped to the current user — see
        // getRequestedAtByTitleIds's own doc comment.
        requestedAt: requestedAtMap[item.id] ?? null,
      };
    });

    // 17.10: "already-owned" filter dropped, see trending's own comment.
    const UPCOMING_SERIES_CAP = 30;
    const cappedItems = itemsWithEmby.slice(0, UPCOMING_SERIES_CAP);

    return {
      items: cappedItems,
      userStatuses,
      episodeProgress,
      page: data.page ?? input.page,
      totalPages: 1,
      totalResults: cappedItems.length,
    };
  });

// ─── Search ───────────────────────────────────────────────────

export const search = os.discover.search.use(authed).handler(async ({ input, context }) => {
  requireTmdb();

  const query = input.query.trim();
  if (!query) {
    return { results: [], page: 1, totalPages: 0, totalResults: 0 };
  }
  const type = input.type ?? null;

  if (type === "person") {
    const personResults = await searchPerson(query, input.page);
    const personItems = (personResults.results ?? []).map((r) => ({
      tmdbId: r.id,
      type: "person" as const,
      title: r.name ?? "",
      posterPath: null,
      profilePath: r.profile_path ?? null,
      overview: null,
      releaseDate: null,
      popularity: r.popularity ?? null,
      voteAverage: null,
      knownForDepartment: r.known_for_department ?? null,
      knownFor:
        (r.known_for
          ?.slice(0, 3)
          .map((k) => k.title ?? (k as { name?: string }).name)
          .filter((s): s is string => !!s) as string[]) ?? null,
    }));
    const personMap = await ensureBrowsePersonsExist(
      personItems.map((r) => ({
        tmdbId: r.tmdbId,
        name: r.title,
        profilePath: r.profilePath,
        knownForDepartment: r.knownForDepartment,
        popularity: r.popularity,
      })),
    );
    return {
      results: personItems.map((r) =>
        Object.assign(r, {
          id: personMap.get(r.tmdbId),
          profilePath: tmdbImageUrl(r.profilePath, "profiles"),
          userStatus: null,
          embyStatus: null,
        }),
      ),
      page: personResults.page ?? input.page,
      totalPages: personResults.total_pages ?? 1,
      totalResults: personResults.total_results ?? 0,
    };
  }

  const raw =
    type === "movie"
      ? await searchMovies(query, input.page)
      : type === "tv"
        ? await searchTv(query, input.page)
        : await searchMulti(query, input.page);

  type SearchResult = {
    id: number;
    media_type?: string;
    title?: string;
    name?: string;
    overview?: string;
    poster_path?: string | null;
    profile_path?: string | null;
    release_date?: string;
    first_air_date?: string;
    popularity?: number;
    vote_average?: number;
  };

  const mapped = ((raw.results ?? []) as SearchResult[])
    .map((r) => {
      if (r.media_type === "person") {
        return {
          tmdbId: r.id,
          type: "person" as const,
          title: r.name ?? "Unknown",
          posterPath: null,
          profilePath: r.profile_path ?? null,
          overview: null,
          releaseDate: null,
          popularity: r.popularity ?? null,
          voteAverage: null,
          knownForDepartment: null,
          knownFor: null,
        };
      }

      const mediaType = r.media_type === "movie" || r.media_type === "tv" ? r.media_type : type;
      if (!mediaType) return null;

      return {
        tmdbId: r.id,
        type: mediaType,
        title: r.title ?? r.name ?? "",
        overview: r.overview ?? null,
        releaseDate: r.release_date ?? r.first_air_date ?? null,
        posterPath: r.poster_path ?? null,
        profilePath: null,
        popularity: r.popularity ?? null,
        voteAverage: r.vote_average ?? null,
        knownForDepartment: null,
        knownFor: null,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const titleResults = mapped.filter(
    (r): r is typeof r & { type: "movie" | "tv" } => r.type !== "person",
  );
  const titleMap = await ensureBrowseTitlesExist(titleResults);

  const personResults = mapped.filter((r) => r.type === "person");
  const personMap = await ensureBrowsePersonsExist(
    personResults.map((r) => ({
      tmdbId: r.tmdbId,
      name: r.title,
      profilePath: r.profilePath,
      knownForDepartment: r.knownForDepartment,
      popularity: r.popularity,
    })),
  );

  const searchTitleIds = titleResults
    .map((r) => titleMap.get(`${r.tmdbId}-${r.type}`)?.id)
    .filter((id): id is string => !!id);
  // 28.08, Sid — real bug: unlike every other discover procedure (trending,
  // popular, upcomingMovies/Series, browse), search never fetched
  // requestedAt at all — a title already requested (household-wide, see
  // getRequestedAtByTitleIds's own doc comment) still showed the plain "+"
  // instead of the "obtaining" badge when found by name here, no matter what
  // was actually true in Radarr/Sonarr.
  const [searchUserStatuses, searchEmbyStatus, searchRequestedAt] =
    searchTitleIds.length > 0
      ? await Promise.all([
          getDisplayStatusesByTitleIds(context.user.id, searchTitleIds),
          getEmbyStatusByTitleIds(searchTitleIds),
          getRequestedAtByTitleIds(searchTitleIds),
        ])
      : [{}, {}, {}];

  const results = mapped.map((r) => {
    if (r.type === "person") {
      return Object.assign(r, {
        id: personMap.get(r.tmdbId),
        profilePath: tmdbImageUrl(r.profilePath, "profiles"),
        userStatus: null,
        embyStatus: null,
      });
    }
    const entry = titleMap.get(`${r.tmdbId}-${r.type}`);
    const emby = entry?.id ? searchEmbyStatus[entry.id] : undefined;
    return Object.assign(r, {
      id: entry?.id,
      posterPath: tmdbImageUrl(r.posterPath, "posters"),
      userStatus: entry?.id ? (searchUserStatuses[entry.id] ?? null) : null,
      embyStatus: emby ? deriveEmbyStatus(emby.inEmbyLibrary, emby.embyItemId) : null,
      requestedAt: entry?.id ? (searchRequestedAt[entry.id] ?? null) : null,
    });
  });

  return {
    results,
    page: raw.page ?? input.page,
    totalPages: raw.total_pages ?? 1,
    totalResults: raw.total_results ?? 0,
  };
});

// ─── Browse (filtered discovery) ──────────────────────────────

export const browse = os.discover.browse.use(authed).handler(async ({ input, context }) => {
  requireTmdb();

  const params: Record<string, string> = {
    sort_by: input.sortBy ?? "popularity.desc",
    "vote_count.gte": "50",
  };
  if (input.genreId) params.with_genres = String(input.genreId);
  if (input.yearMin) {
    const key = input.type === "movie" ? "primary_release_date.gte" : "first_air_date.gte";
    params[key] = `${input.yearMin}-01-01`;
  }
  if (input.yearMax) {
    const key = input.type === "movie" ? "primary_release_date.lte" : "first_air_date.lte";
    params[key] = `${input.yearMax}-12-31`;
  }
  if (input.ratingMin != null) params["vote_average.gte"] = String(input.ratingMin);
  if (input.language) params.with_original_language = input.language;
  if (input.platformId) {
    const tmdbIds = await getPlatformTmdbIds(input.platformId);
    if (tmdbIds.length > 0) {
      params.with_watch_providers = tmdbIds.join("|");
      params.watch_region = WATCH_REGION;
    }
  }

  const results = await discoverTmdb(input.type, params, input.page);

  type DiscoverResult = NonNullable<typeof results.results>[number] & {
    title?: string;
    name?: string;
    release_date?: string;
    first_air_date?: string;
  };

  const baseItems = ((results.results ?? []) as DiscoverResult[])
    .filter((r) => r.poster_path && !isDiscoveryNoise(r as Record<string, unknown>))
    .map((r) => ({
      tmdbId: r.id,
      type: input.type,
      title: r.title ?? r.name ?? "",
      posterPath: r.poster_path ?? null,
      releaseDate: (r.release_date as string | undefined) ?? null,
      firstAirDate: (r.first_air_date as string | undefined) ?? null,
      voteAverage: r.vote_average ?? null,
    }));

  const titleMap = await ensureBrowseTitlesExist(baseItems);
  const items = baseItems.map((item) => {
    const entry = titleMap.get(`${item.tmdbId}-${item.type}`);
    return Object.assign(item, {
      id: entry?.id ?? "",
      posterPath: tmdbImageUrl(item.posterPath, "posters"),
      posterThumbHash: entry?.posterThumbHash ?? null,
    });
  });

  const titleIds = items.map((r) => r.id);
  const [userStatuses, episodeProgress, embyStatusMap, requestedAtMap] =
    titleIds.length > 0
      ? await Promise.all([
          getDisplayStatusesByTitleIds(context.user.id, titleIds),
          getEpisodeProgressByTitleIds(context.user.id, titleIds),
          getEmbyStatusByTitleIds(titleIds),
          getRequestedAtByTitleIds(titleIds),
        ])
      : [{}, {}, {}, {}];

  const itemsWithEmby = items.map((item) => {
    const emby = embyStatusMap[item.id];
    return {
      ...item,
      embyStatus: emby ? deriveEmbyStatus(emby.inEmbyLibrary, emby.embyItemId) : null,
      // Household-wide, not scoped to the current user — see
      // getRequestedAtByTitleIds's own doc comment.
      requestedAt: requestedAtMap[item.id] ?? null,
    };
  });

  // 17.10: "already-owned/already-seen" filter dropped, see trending's own
  // comment — was the 24.08 "badge poubelle ou déjà dispo" behaviour.
  const cappedItems = itemsWithEmby;

  return {
    items: cappedItems,
    userStatuses,
    episodeProgress,
    page: results.page ?? input.page,
    totalPages: results.total_pages ?? 1,
    totalResults: results.total_results ?? 0,
  };
});

// ─── Genres ───────────────────────────────────────────────────

export const genres = os.discover.genres.use(authed).handler(async ({ input }) => {
  requireTmdb();
  const data = await getGenres(input.type);
  return {
    genres: (data.genres ?? []).map((g) => ({
      id: g.id,
      name: g.name ?? "",
    })),
  };
});

// ─── Platforms ────────────────────────────────────────────────

export const platforms = os.discover.platforms.use(authed).handler(async () => {
  const allPlatforms = await listPlatforms();
  const tmdbIdsMap = await getPlatformTmdbIdMap(allPlatforms.map((p) => p.id));
  return {
    platforms: allPlatforms.map((p) => ({
      id: p.id,
      name: p.name,
      tmdbProviderIds: tmdbIdsMap.get(p.id) ?? [],
      logoPath: tmdbImageUrl(p.logoPath, "logos"),
      isSubscription: p.isSubscription,
    })),
  };
});

// ─── Recommendations ──────────────────────────────────────────

export const recommendations = os.discover.recommendations
  .use(authed)
  .handler(async ({ input, context }) => {
    const feed = await getRecommendationsFeed(context.user.id, input.type);
    const baseItems = feed
      .filter((t): t is NonNullable<typeof t> => t != null)
      .slice(0, 10)
      .map((t) => ({
        id: t.id,
        tmdbId: t.tmdbId,
        type: t.type,
        title: t.title,
        posterPath: tmdbImageUrl(t.posterPath, "posters"),
        posterThumbHash: t.posterThumbHash ?? null,
        releaseDate: t.releaseDate ?? null,
        firstAirDate: t.firstAirDate ?? null,
        voteAverage: t.voteAverage,
      }));
    // 26.08, Sid — full badge audit: same gap as everywhere else, this fed
    // "Recommended for You" cards with no embyStatus/requestedAt at all.
    const titleIds = baseItems.map((t) => t.id);
    const [embyStatusMap, requestedAtMap] =
      titleIds.length > 0
        ? await Promise.all([getEmbyStatusByTitleIds(titleIds), getRequestedAtByTitleIds(titleIds)])
        : [{}, {}];
    const items = baseItems.map((item) => {
      const emby = embyStatusMap[item.id];
      return {
        ...item,
        embyStatus: emby ? deriveEmbyStatus(emby.inEmbyLibrary, emby.embyItemId) : null,
        requestedAt: requestedAtMap[item.id] ?? null,
      };
    });
    return { items };
  });

// ─── Untracked Emby library ────────────────────────────────────

export const untrackedEmbyLibrary = os.discover.untrackedEmbyLibrary
  .use(authed)
  .handler(async ({ input, context }) => {
    const feed = await getUntrackedEmbyLibraryFeed(context.user.id, 20, input.type);
    const items = feed.map((t) => ({
      id: t.id,
      tmdbId: t.tmdbId,
      type: t.type,
      title: t.title,
      posterPath: tmdbImageUrl(t.posterPath, "posters"),
      posterThumbHash: t.posterThumbHash ?? null,
      releaseDate: t.releaseDate ?? null,
      firstAirDate: t.firstAirDate ?? null,
      voteAverage: t.voteAverage,
      embyLibraryName: t.embyLibraryName,
    }));
    return {
      items,
      totalResults: await getUntrackedEmbyLibraryCount(context.user.id, input.type),
    };
  });

// ─── Requested, not yet available ──────────────────────────────

export const requestedNotAvailable = os.discover.requestedNotAvailable
  .use(authed)
  .handler(async ({ input, context }) => {
    // 26.08, Sid — real total must reflect the post-hasWatchedSomething-
    // filter count (below), which getRequestedNotAvailableCount's raw
    // WHERE-clause count can't see. Household "requested but not available"
    // realistically never approaches this cap, so fetching generously here
    // and counting the actual filtered set is simpler and exact.
    const rows = await getRequestedNotAvailable(input.type, 500);

    // Real bug found live (24.08, Sid — "Line of Duty" showed both "À jour"
    // and "Demandé" at once): titles.inEmbyLibrary alone isn't a reliable
    // "has she really got nothing to watch" signal — a title can be fully
    // watched (via KOSync/WebDAV progress, a Trakt-import watch history,
    // etc.) without ever going through the Sofa Emby scan that flips that
    // flag. Any real display status beyond "never touched" means drop it
    // from this list regardless of the raw Emby flag.
    const titleIds = rows.map((t) => t.id);
    const userStatuses =
      titleIds.length > 0 ? await getDisplayStatusesByTitleIds(context.user.id, titleIds) : {};
    // "in_watchlist" (just added, nothing watched yet) and "dropped" are
    // fine here — only real playback history disqualifies.
    const hasWatchedSomething = (status: string | undefined) =>
      status === "watching" || status === "caught_up" || status === "completed";
    const filteredRows = rows.filter((t) => !hasWatchedSomething(userStatuses[t.id]));

    const items = filteredRows.map((t) => ({
      id: t.id,
      tmdbId: t.tmdbId,
      type: t.type as "movie" | "tv",
      title: t.title,
      posterPath: tmdbImageUrl(t.posterPath, "posters"),
      posterThumbHash: t.posterThumbHash ?? null,
      releaseDate: t.releaseDate,
      firstAirDate: t.firstAirDate,
      voteAverage: t.voteAverage,
      requestedAt: t.requestedAt as Date,
    }));
    return { items, totalResults: filteredRows.length };
  });
