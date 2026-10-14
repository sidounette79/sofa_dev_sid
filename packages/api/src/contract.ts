import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";

import { AppErrorCode, appErrorData } from "./errors";
import {
  AdminSettingsOutput,
  AdminSettingsUpdateInput,
  BackupCreateOutput,
  BackupScheduleOutput,
  BackupsListOutput,
  ContinueWatchingInput,
  ContinueWatchingOutput,
  NowPlayingOutput,
  UntrackedEmbyLibraryOutput,
  RequestedNotAvailableOutput,
  OptionalMediaTypeParam,
  UpdateEmbyLibrariesInput,
  UpdateEmbyUsernameInput,
  CreateImportJobInput,
  CreateIntegrationInput,
  DiscoverInput,
  DiscoverOutput,
  DiscoverRecommendationsOutput,
  FilenameParam,
  GenresOutput,
  IdParam,
  QuickEpisodeActionOutput,
  ImportJobEvent,
  ImportJobSchema,
  ImportPreviewSchema,
  EmbyLibrariesListOutput,
  IntegrationOutput,
  IntegrationsListOutput,
  LibraryGenresOutput,
  LibraryListInput,
  LibraryListOutput,
  RequestOptionsOutput,
  AdminUserRequestDefaultsListOutput,
  UserRequestDefaultsOutput,
  SetUserRequestDefaultsInput,
  RequestMovieInput,
  RequestSeriesInput,
  UnresolvedSeriesRequestsOutput,
  AvailablePlaybackDevicesOutput,
  FavoritePlaybackDevicesOutput,
  SetFavoritePlaybackDevicesInput,
  DismissPlaybackDeviceInput,
  PlayOnDeviceInput,
  PlaybackActivityInput,
  PlaybackActivityOutput,
  PlaybackReportingUsersOutput,
  LibraryStatisticsOutput,
  LibraryStatsOutput,
  MediaTypeParam,
  PageParam,
  PaginatedInput,
  ParseFileInput,
  ParsePayloadInput,
  PendingLibraryOutput,
  PersonDetailOutput,
  PlatformsListOutput,
  PopularOutput,
  ProviderParam,
  PublicInfoOutput,
  PurgeImageCacheOutput,
  PurgeMetadataCacheOutput,
  PushSubscribeInput,
  PushUnsubscribeInput,
  RestoreBackupInput,
  SearchInput,
  SearchOutput,
  SystemHealthOutput,
  SystemStatusOutput,
  TitleDetailOutput,
  TitleRecommendationsOutput,
  TrendingOutput,
  TrendingTypeParam,
  TriggerJobInput,
  TriggerJobOutput,
  UnwatchInput,
  UpdateNameInput,
  UpdateRatingInput,
  UpdateScheduleInput,
  UpdateStatusInput,
  UpdateUserPlatformsInput,
  UpcomingInput,
  UpcomingOutput,
  UploadAvatarInput,
  UploadAvatarOutput,
  UserInfoOutput,
  UserPlatformsOutput,
  WatchHistoryInput,
  WatchHistoryOutput,
  WatchInput,
} from "./schemas";

const tmdbNotConfiguredError = {
  PRECONDITION_FAILED: {
    message: "TMDB API key is not configured",
    data: appErrorData(AppErrorCode.TMDB_NOT_CONFIGURED),
  },
} as const;

export const contract = {
  // ─── Titles ─────────────────────────────────────────────────
  titles: {
    get: oc
      .route({
        method: "GET",
        path: "/titles/{id}",
        tags: ["Titles"],
        summary: "Get title details",
        description:
          "Fetch full title metadata including seasons, cast, and streaming availability. Imports from TMDB on first access if not yet cached locally.",
        successDescription: "Full title with seasons, cast, and availability offers",
      })
      .input(IdParam)
      .output(TitleDetailOutput)
      .errors({
        NOT_FOUND: {
          message: "Title not found",
          data: appErrorData(AppErrorCode.TITLE_NOT_FOUND),
        },
      }),
    similar: oc
      .route({
        method: "GET",
        path: "/titles/{id}/similar",
        tags: ["Titles"],
        summary: "Get similar titles",
        description:
          "Fetch similar titles based on locally cached recommendation data, along with the user's statuses for each.",
        successDescription: "Similar titles with user statuses",
      })
      .input(IdParam)
      .output(TitleRecommendationsOutput),
    pendingLibrary: oc
      .route({
        method: "GET",
        path: "/titles/{id}/pending-library",
        tags: ["Titles"],
        summary: "Get the library folder a requested title will land in",
        description:
          "For a title that's been requested but isn't on Emby yet: reads Radarr/Sonarr directly for the real root folder already assigned to that request (not guessed from current user defaults, which can drift). Null if not requested, not found in Radarr/Sonarr yet, or Radarr/Sonarr isn't reachable.",
        successDescription: "The root folder path, or null",
      })
      .input(IdParam)
      .output(PendingLibraryOutput),
  },

  // ─── Tracking ───────────────────────────────────────────────
  tracking: {
    watch: oc
      .route({
        method: "POST",
        path: "/tracking/watch",
        tags: ["Tracking"],
        summary: "Mark items as watched",
        description:
          "Mark one or more items as watched. Use scope to indicate what the IDs refer to: movie (title IDs), episode (episode IDs), season (season IDs), or series (title IDs to mark all episodes).",
      })
      .input(WatchInput)
      .output(z.void()),
    unwatch: oc
      .route({
        method: "POST",
        path: "/tracking/unwatch",
        tags: ["Tracking"],
        summary: "Remove watch records",
        description:
          "Remove watch records for one or more items. Use scope to indicate what the IDs refer to: movie, episode, season, or series.",
      })
      .input(UnwatchInput)
      .output(z.void()),
    updateStatus: oc
      .route({
        method: "PUT",
        path: "/tracking/titles/{id}/status",
        tags: ["Tracking"],
        summary: "Update tracking status",
        description:
          "Set the user's tracking status for a title. Use null to remove the title from the library entirely.",
      })
      .input(UpdateStatusInput)
      .output(z.void())
      .errors({
        NOT_FOUND: {
          message: "Title not found",
          data: appErrorData(AppErrorCode.TITLE_NOT_FOUND),
        },
      }),
    rate: oc
      .route({
        method: "PUT",
        path: "/tracking/titles/{id}/rating",
        tags: ["Tracking"],
        summary: "Rate a title",
        description: "Set a 0-5 star rating for a title. Use 0 to clear the rating.",
      })
      .input(UpdateRatingInput)
      .output(z.void()),
    watchNext: oc
      .route({
        method: "POST",
        path: "/tracking/titles/{id}/watch-next",
        tags: ["Tracking"],
        summary: "Mark the next unwatched episode as watched",
        description:
          "Finds and marks the next unwatched (already-aired) episode of a TV series as watched.",
      })
      .input(IdParam)
      .output(QuickEpisodeActionOutput),
    unwatchLast: oc
      .route({
        method: "POST",
        path: "/tracking/titles/{id}/unwatch-last",
        tags: ["Tracking"],
        summary: "Unmark the most recently watched episode",
        description: "Finds and unmarks the last watched episode of a TV series.",
      })
      .input(IdParam)
      .output(QuickEpisodeActionOutput),
    rewatch: oc
      .route({
        method: "POST",
        path: "/tracking/titles/{id}/rewatch",
        tags: ["Tracking"],
        summary: "Start a new watch-through of a title",
        description:
          "TV: bumps the title's rewatch cycle so it reappears in To Watch as unwatched, without erasing previous cycles' watch history. Movies: logs another watch.",
      })
      .input(IdParam)
      .output(z.void()),
    userInfo: oc
      .route({
        method: "GET",
        path: "/tracking/titles/{id}",
        tags: ["Tracking"],
        summary: "Get user's tracking info for a title",
        description:
          "Fetch the current user's tracking status, rating, and watched episode IDs for a title.",
        successDescription: "User's status, rating, and list of watched episode IDs",
      })
      .input(IdParam)
      .output(UserInfoOutput),
    stats: oc
      .route({
        method: "GET",
        path: "/tracking/stats",
        tags: ["Tracking"],
        summary: "Get watch statistics",
        description:
          "Fetch the user's watch counts grouped by time period. Useful for rendering activity charts and dashboard counters.",
        successDescription: "Watch counts bucketed by time period",
      })
      .input(WatchHistoryInput)
      .output(WatchHistoryOutput),
  },

  // ─── Library ────────────────────────────────────────────────
  library: {
    list: oc
      .route({
        method: "GET",
        path: "/library",
        tags: ["Library"],
        summary: "List library with filters",
        description:
          "Fetch paginated, filtered, and sorted titles from the user's library. Supports filtering by status, type, genre, rating, year, content rating, and streaming availability.",
        successDescription: "Filtered library items with user statuses and ratings",
      })
      .input(LibraryListInput)
      .output(LibraryListOutput),
    genres: oc
      .route({
        method: "GET",
        path: "/library/genres",
        tags: ["Library"],
        summary: "List genres in user's library",
        description:
          "Get the distinct genres present in the user's library, ordered alphabetically. Used to populate the genre filter dropdown.",
        successDescription: "Genres present in the library",
      })
      .output(LibraryGenresOutput),
    stats: oc
      .route({
        method: "GET",
        path: "/library/stats",
        tags: ["Library"],
        summary: "Get library statistics",
        description: "Fetch aggregate library counts: total titles and completed titles.",
        successDescription: "Library size and completed count",
      })
      .output(LibraryStatsOutput),
    statistics: oc
      .route({
        method: "GET",
        path: "/library/statistics",
        tags: ["Library"],
        summary: "Get extended library statistics",
        description:
          "Fetch extended aggregate statistics for the statistics page: watch totals, media type and status distributions, and rating stats.",
        successDescription: "Extended library statistics",
      })
      .output(LibraryStatisticsOutput),
    continueWatching: oc
      .route({
        method: "GET",
        path: "/library/continue-watching",
        tags: ["Library"],
        summary: "Get continue watching list",
        description:
          "Fetch TV shows the user is currently watching, with the next unwatched episode and progress for each.",
        successDescription: "In-progress shows with next episode and watch progress",
      })
      .input(ContinueWatchingInput)
      .output(ContinueWatchingOutput),
    nowPlaying: oc
      .route({
        method: "GET",
        path: "/library/now-playing",
        tags: ["Library"],
        summary: "Get currently playing Emby sessions",
        description:
          "Fetch sessions currently playing on Emby, matched against the Sofa library where possible, for live dashboard display.",
        successDescription: "Currently playing sessions",
      })
      .output(NowPlayingOutput),
    upcoming: oc
      .route({
        method: "GET",
        path: "/library/upcoming",
        tags: ["Library"],
        summary: "Get upcoming episodes and movies",
        description:
          "Fetch upcoming episodes and movie releases for titles in the user's library, sorted by date. Supports cursor-based pagination.",
        successDescription: "Upcoming items sorted by date with streaming info",
      })
      .input(UpcomingInput)
      .output(UpcomingOutput),
  },

  // ─── Discover ───────────────────────────────────────────────
  discover: {
    trending: oc
      .route({
        method: "GET",
        path: "/discover/trending",
        tags: ["Discover"],
        summary: "Get trending titles",
        description:
          "Fetch today's trending movies and/or TV shows from TMDB, including a featured hero title and the user's statuses.",
        successDescription: "Trending items, hero spotlight, and user statuses",
      })
      .input(TrendingTypeParam.merge(PageParam))
      .output(TrendingOutput)
      .errors(tmdbNotConfiguredError),
    popular: oc
      .route({
        method: "GET",
        path: "/discover/popular",
        tags: ["Discover"],
        summary: "Get popular titles",
        description:
          "Fetch currently popular movies or TV shows from TMDB with the user's tracking statuses.",
        successDescription: "Popular items with user statuses",
      })
      .input(MediaTypeParam.merge(PageParam))
      .output(PopularOutput)
      .errors(tmdbNotConfiguredError),
    upcomingMovies: oc
      .route({
        method: "GET",
        path: "/discover/upcoming-movies",
        tags: ["Discover"],
        summary: "Get upcoming movie releases",
        description:
          "Fetch movies with upcoming release dates from TMDB — new releases nobody has requested yet, distinct from library.upcoming (which only covers already-tracked titles).",
        successDescription: "Upcoming movies with user statuses",
      })
      .input(PageParam)
      .output(PopularOutput)
      .errors(tmdbNotConfiguredError),
    upcomingSeries: oc
      .route({
        method: "GET",
        path: "/discover/upcoming-series",
        tags: ["Discover"],
        summary: "Get upcoming series releases",
        description:
          "Fetch TV series with upcoming first-air dates from TMDB — new releases nobody has requested yet.",
        successDescription: "Upcoming series with user statuses",
      })
      .input(PageParam)
      .output(PopularOutput)
      .errors(tmdbNotConfiguredError),
    search: oc
      .route({
        method: "GET",
        path: "/discover/search",
        tags: ["Discover"],
        summary: "Search movies, TV shows, and people",
        description:
          "Full-text search across movies, TV shows, and people via TMDB. Optionally filter by media type.",
        successDescription: "Search results with metadata",
      })
      .input(SearchInput)
      .output(SearchOutput)
      .errors(tmdbNotConfiguredError),
    browse: oc
      .route({
        method: "GET",
        path: "/discover/browse",
        tags: ["Discover"],
        summary: "Browse titles with filters",
        description:
          "Browse movies or TV shows filtered by genre, sorted by popularity. Returns user statuses and episode progress.",
        successDescription: "Filtered titles with user statuses",
      })
      .input(DiscoverInput)
      .output(DiscoverOutput)
      .errors(tmdbNotConfiguredError),
    genres: oc
      .route({
        method: "GET",
        path: "/discover/genres",
        tags: ["Discover"],
        summary: "List genres",
        description:
          "Fetch the list of TMDB genres for movies or TV shows. Used to populate genre filters for discovery.",
        successDescription: "Genre ID/name pairs",
      })
      .input(MediaTypeParam)
      .output(GenresOutput)
      .errors(tmdbNotConfiguredError),
    platforms: oc
      .route({
        method: "GET",
        path: "/discover/platforms",
        tags: ["Discover"],
        summary: "List available streaming platforms",
        description:
          "Fetch all available streaming platforms, ordered by popularity. Includes subscription status for filtering.",
        successDescription: "Platform list with logos and metadata",
      })
      .output(PlatformsListOutput),
    recommendations: oc
      .route({
        method: "GET",
        path: "/discover/recommendations",
        tags: ["Discover"],
        summary: "Get personalized recommendations",
        description:
          "Fetch personalized title recommendations based on the user's library and watch history.",
        successDescription: "Recommended titles",
      })
      .input(OptionalMediaTypeParam)
      .output(DiscoverRecommendationsOutput),
    untrackedEmbyLibrary: oc
      .route({
        method: "GET",
        path: "/discover/untracked-emby-library",
        tags: ["Discover"],
        summary: "Get untracked titles available on Emby",
        description:
          "Fetch titles physically available on the Emby server that the user hasn't added to their library yet.",
        successDescription: "Untracked titles available on the Emby server",
      })
      .input(OptionalMediaTypeParam)
      .output(UntrackedEmbyLibraryOutput),
    requestedNotAvailable: oc
      .route({
        method: "GET",
        path: "/discover/requested-not-available",
        tags: ["Discover"],
        summary: "Get requested titles not yet available",
        description:
          "Fetch titles that were requested via Radarr/Sonarr (through Sofa's Request button or reconciled from Radarr/Sonarr directly) but aren't on Emby yet.",
        successDescription: "Requested titles not yet on Emby",
      })
      .input(MediaTypeParam)
      .output(RequestedNotAvailableOutput),
  },

  // ─── People ─────────────────────────────────────────────────
  people: {
    get: oc
      .route({
        method: "GET",
        path: "/people/{id}",
        tags: ["People"],
        summary: "Get person details",
        description:
          "Fetch a person's profile and paginated filmography. Imports from TMDB on first access if not yet cached locally.",
        successDescription:
          "Person profile, paginated filmography credits, and user statuses for their titles",
      })
      .input(IdParam.merge(PaginatedInput))
      .output(PersonDetailOutput)
      .errors({
        NOT_FOUND: {
          message: "Person not found",
          data: appErrorData(AppErrorCode.PERSON_NOT_FOUND),
        },
      }),
  },

  // ─── Account ────────────────────────────────────────────────
  account: {
    updateName: oc
      .route({
        method: "PUT",
        path: "/account/name",
        tags: ["Account"],
        summary: "Update display name",
        description: "Change the current user's display name.",
      })
      .input(UpdateNameInput)
      .output(z.void()),
    uploadAvatar: oc
      .route({
        method: "POST",
        path: "/account/avatar",
        tags: ["Account"],
        summary: "Upload avatar",
        description:
          "Upload a new profile avatar image. Accepts JPEG, PNG, WebP, or GIF up to 2 MB.",
        successDescription: "URL of the uploaded avatar image",
      })
      .input(UploadAvatarInput)
      .output(UploadAvatarOutput),
    removeAvatar: oc
      .route({
        method: "DELETE",
        path: "/account/avatar",
        tags: ["Account"],
        summary: "Remove avatar",
        description: "Delete the current user's profile avatar, reverting to the default.",
      })
      .input(z.void())
      .output(z.void()),
    platforms: oc
      .route({
        method: "GET",
        path: "/account/platforms",
        tags: ["Account"],
        summary: "Get user's streaming platforms",
        description: "Fetch the current user's subscribed streaming platform IDs.",
        successDescription: "List of platform IDs",
      })
      .output(UserPlatformsOutput),
    updatePlatforms: oc
      .route({
        method: "PUT",
        path: "/account/platforms",
        tags: ["Account"],
        summary: "Update streaming platforms",
        description: "Set the current user's subscribed streaming platforms.",
      })
      .input(UpdateUserPlatformsInput)
      .output(z.void()),
    integrations: {
      list: oc
        .route({
          method: "GET",
          path: "/account/integrations",
          tags: ["Account"],
          summary: "List integrations",
          description:
            "Fetch all configured media server integrations for the current user, including recent webhook/sync events for each.",
          successDescription: "Integrations with their recent events",
        })
        .output(IntegrationsListOutput),
      create: oc
        .route({
          method: "POST",
          path: "/account/integrations",
          tags: ["Account"],
          summary: "Create or update integration",
          description:
            "Create a new media server integration or update an existing one. Generates a unique webhook token for the provider.",
          successDescription: "Created or updated integration with token",
        })
        .input(CreateIntegrationInput)
        .output(IntegrationOutput),
      delete: oc
        .route({
          method: "DELETE",
          path: "/account/integrations/{provider}",
          tags: ["Account"],
          summary: "Delete integration",
          description: "Remove a media server integration and all its event history.",
        })
        .input(ProviderParam)
        .output(z.void()),
      regenerateToken: oc
        .route({
          method: "POST",
          path: "/account/integrations/{provider}/regenerate-token",
          tags: ["Account"],
          summary: "Regenerate webhook token",
          description:
            "Generate a new webhook token for an integration. The old token is immediately invalidated.",
          successDescription: "Integration with new token",
        })
        .input(ProviderParam)
        .output(IntegrationOutput)
        .errors({
          NOT_FOUND: {
            message: "Integration not found",
            data: appErrorData(AppErrorCode.INTEGRATION_NOT_FOUND),
          },
        }),
      updateEmbyUsername: oc
        .route({
          method: "POST",
          path: "/account/integrations/emby/username",
          tags: ["Account"],
          summary: "Link Emby username",
          description:
            "Link an Emby username to this Sofa account, used to filter Now Playing sessions to only this user's playback.",
          successDescription: "Integration with updated Emby username",
        })
        .input(UpdateEmbyUsernameInput)
        .output(IntegrationOutput)
        .errors({
          NOT_FOUND: {
            message: "Integration not found",
            data: appErrorData(AppErrorCode.INTEGRATION_NOT_FOUND),
          },
        }),
      listEmbyLibraries: oc
        .route({
          method: "GET",
          path: "/account/integrations/emby/libraries",
          tags: ["Account"],
          summary: "List available Emby libraries",
          description:
            "Fetch the list of scannable Emby libraries and which ones this user has claimed as their own.",
          successDescription: "Available Emby libraries and current selection",
        })
        .output(EmbyLibrariesListOutput),
      updateEmbyLibraries: oc
        .route({
          method: "POST",
          path: "/account/integrations/emby/libraries",
          tags: ["Account"],
          summary: "Claim Emby libraries for this user",
          description:
            "Set which Emby libraries belong to this user. Titles found in these libraries are automatically added to their watchlist on the next scan.",
          successDescription: "Updated library selection",
        })
        .input(UpdateEmbyLibrariesInput)
        .output(EmbyLibrariesListOutput),
    },
  },

  // ─── Push notifications ──────────────────────────────────────
  notifications: {
    subscribe: oc
      .route({
        method: "POST",
        path: "/notifications/subscribe",
        tags: ["Notifications"],
        summary: "Register a Web Push subscription",
        description:
          "Registers (or refreshes) this browser/device's Web Push subscription for the current user — episode-release and series-status-change notifications.",
      })
      .input(PushSubscribeInput)
      .output(z.void()),
    unsubscribe: oc
      .route({
        method: "POST",
        path: "/notifications/unsubscribe",
        tags: ["Notifications"],
        summary: "Remove a Web Push subscription",
        description: "Removes this browser/device's Web Push subscription for the current user.",
      })
      .input(PushUnsubscribeInput)
      .output(z.void()),
  },

  mediaRequests: {
    getOptions: oc
      .route({
        method: "GET",
        path: "/media-requests/options",
        tags: ["MediaRequests"],
        summary: "Get Radarr/Sonarr root folders and quality profiles",
        description:
          "Fetch the available root folders and quality profiles from Radarr and Sonarr, for the request dialog's dropdowns.",
        successDescription: "Root folders and quality profiles",
      })
      .output(RequestOptionsOutput),
    listUserDefaults: oc
      .route({
        method: "GET",
        path: "/media-requests/user-defaults",
        tags: ["MediaRequests"],
        summary: "List every user's default root folder + quality profile (admin only)",
        description: "Admin-only: fetch stored request defaults for every Sofa user that has any set.",
        successDescription: "Every user's defaults",
      })
      .output(AdminUserRequestDefaultsListOutput),
    getMyDefaults: oc
      .route({
        method: "GET",
        path: "/media-requests/my-defaults",
        tags: ["MediaRequests"],
        summary: "Get my default root folder + quality profile",
        description: "Fetch the current user's stored default Radarr/Sonarr root folder + quality profile.",
        successDescription: "This user's defaults",
      })
      .output(UserRequestDefaultsOutput),
    setUserDefaults: oc
      .route({
        method: "POST",
        path: "/media-requests/user-defaults",
        tags: ["MediaRequests"],
        summary: "Set a user's default root folder + quality profile (admin only)",
        description:
          "Admin-only: set the default Radarr/Sonarr root folder + quality profile for any Sofa user.",
        successDescription: "No content",
      })
      .input(SetUserRequestDefaultsInput),
    requestMovie: oc
      .route({
        method: "POST",
        path: "/media-requests/movie",
        tags: ["MediaRequests"],
        summary: "Request a movie",
        description:
          "Push a movie straight to Radarr with a chosen (or the requesting user's default) root folder + quality profile, monitored and searched immediately. Also adds the title to the watchlist, same as a plain add.",
        successDescription: "No content",
      })
      .input(RequestMovieInput)
      .errors({
        NOT_FOUND: {
          message: "Title not found",
          data: appErrorData(AppErrorCode.TITLE_NOT_FOUND),
        },
        BAD_REQUEST: { message: "No root folder / quality profile available" },
      }),
    requestSeries: oc
      .route({
        method: "POST",
        path: "/media-requests/series",
        tags: ["MediaRequests"],
        summary: "Request a series",
        description:
          "Push a series straight to Sonarr with a chosen (or the requesting user's default) root folder + quality profile + season selection, monitored and searched immediately. Also adds the title to the watchlist, same as a plain add.",
        successDescription: "No content",
      })
      .input(RequestSeriesInput)
      .errors({
        NOT_FOUND: {
          message: "Title not found",
          data: appErrorData(AppErrorCode.TITLE_NOT_FOUND),
        },
        BAD_REQUEST: {
          message: "No root folder / quality profile available",
          // 06.09, Sid: distinguish "TheTVDB doesn't have this show yet" (a
          // normal, expected, retry-later case — she wanted a friendlier
          // toast for it) from every other BAD_REQUEST here, which are real
          // user-input problems.
          data: appErrorData(AppErrorCode.NO_TVDB_ID).optional(),
        },
      }),
    listUnresolvedSeriesRequests: oc
      .route({
        method: "GET",
        path: "/media-requests/series/unresolved",
        tags: ["MediaRequests"],
        summary: "List series requests still waiting on TheTVDB",
        description:
          "Series she tried to request that TheTVDB doesn't have indexed yet (\"En attente TMDB\") — persists regardless of the show's air date, unlike the Upcoming feed, until a plain Request succeeds.",
        successDescription: "Titles awaiting a TVDB ID",
      })
      .output(UnresolvedSeriesRequestsOutput),
  },
  playbackDevices: {
    listAvailable: oc
      .route({
        method: "GET",
        path: "/playback-devices/available",
        tags: ["PlaybackDevices"],
        summary: "List every device this user's Emby account has connected with",
        description:
          "Full device pool for this user's own Emby account (every phone/tablet/TV it's ever used), for the favorites picker to choose 2-3 from.",
        successDescription: "Available devices",
      })
      .output(AvailablePlaybackDevicesOutput),
    listFavorites: oc
      .route({
        method: "GET",
        path: "/playback-devices/favorites",
        tags: ["PlaybackDevices"],
        summary: "List this user's saved playback device shortlist",
        description:
          "The user's saved shortlist, each flagged online/offline against Emby's current live sessions.",
        successDescription: "Favorite devices",
      })
      .output(FavoritePlaybackDevicesOutput),
    setFavorites: oc
      .route({
        method: "POST",
        path: "/playback-devices/favorites",
        tags: ["PlaybackDevices"],
        summary: "Replace this user's playback device shortlist",
        successDescription: "No content",
      })
      .input(SetFavoritePlaybackDevicesInput),
    dismiss: oc
      .route({
        method: "POST",
        path: "/playback-devices/dismiss",
        tags: ["PlaybackDevices"],
        summary: "Permanently hide a device from this user's availability picker",
        successDescription: "No content",
      })
      .input(DismissPlaybackDeviceInput),
    playOn: oc
      .route({
        method: "POST",
        path: "/playback-devices/play",
        tags: ["PlaybackDevices"],
        summary: "Start playback of a movie or episode on another Emby session",
        description:
          "Remote-controls another Emby session (e.g. a TV's native Emby app) to start playing, the same mechanism Emby's own apps use to cast between devices on one account.",
        successDescription: "No content",
      })
      .input(PlayOnDeviceInput)
      .errors({
        BAD_REQUEST: {
          message: "Playback device error",
          data: appErrorData(AppErrorCode.PLAYBACK_DEVICE_ERROR),
        },
      }),
  },
  playbackReporting: {
    activity: oc
      .route({
        method: "GET",
        path: "/playback-reporting/activity",
        tags: ["PlaybackReporting"],
        summary: "Admin-only: real Emby playback activity log (Tautulli-style)",
        description:
          "Queries Emby's Playback Reporting plugin directly — real Emby accounts and history, independent of Sofa's own per-user tracking.",
        successDescription: "A page of activity",
      })
      .input(PlaybackActivityInput)
      .output(PlaybackActivityOutput),
    users: oc
      .route({
        method: "GET",
        path: "/playback-reporting/users",
        tags: ["PlaybackReporting"],
        summary: "Admin-only: real Emby accounts with at least one logged session",
        successDescription: "Users",
      })
      .output(PlaybackReportingUsersOutput),
  },
  system: {
    publicInfo: oc
      .route({
        method: "GET",
        path: "/system/public-info",
        tags: ["System"],
        summary: "Get public instance info",
        description:
          "Fetch public information about this Sofa instance including authentication configuration. Does not require authentication.",
        successDescription: "Instance configuration, auth settings, and status",
      })
      .output(PublicInfoOutput),
    status: oc
      .route({
        method: "GET",
        path: "/system/status",
        tags: ["System"],
        summary: "Get internal system config",
        description:
          "Returns internal configuration such as the public API URL. Requires authentication.",
        successDescription: "Internal system configuration",
      })
      .output(SystemStatusOutput),
  },

  // ─── Admin ──────────────────────────────────────────────────
  admin: {
    settings: {
      get: oc
        .route({
          method: "GET",
          path: "/admin/settings",
          tags: ["Admin"],
          summary: "Get admin settings",
          description:
            "Fetch all admin-configurable settings: registration and update checks.",
          successDescription: "Current admin settings",
        })
        .output(AdminSettingsOutput),
      update: oc
        .route({
          method: "PATCH",
          path: "/admin/settings",
          tags: ["Admin"],
          summary: "Update admin settings",
          description:
            "Partially update admin settings. Only provided sections are changed; omitted sections keep their current values.",
        })
        .input(AdminSettingsUpdateInput)
        .output(z.void()),
    },
    backups: {
      list: oc
        .route({
          method: "GET",
          path: "/admin/backups",
          tags: ["Admin"],
          summary: "List backups",
          description: "Fetch all database backups with their sizes and creation times.",
          successDescription: "Available backups",
        })
        .output(BackupsListOutput),
      create: oc
        .route({
          method: "POST",
          path: "/admin/backups",
          tags: ["Admin"],
          summary: "Create backup",
          description:
            "Create a new manual database backup. The backup is tagged as a manual backup.",
          successDescription: "Created backup metadata",
        })
        .input(z.void())
        .output(BackupCreateOutput),
      delete: oc
        .route({
          method: "DELETE",
          path: "/admin/backups/{filename}",
          tags: ["Admin"],
          summary: "Delete backup",
          description: "Permanently delete a database backup file by filename.",
        })
        .input(FilenameParam)
        .output(z.void())
        .errors({
          NOT_FOUND: {
            message: "Backup not found",
            data: appErrorData(AppErrorCode.BACKUP_NOT_FOUND),
          },
          BAD_REQUEST: {
            message: "Failed to delete backup",
            data: appErrorData(AppErrorCode.BACKUP_DELETE_FAILED),
          },
        }),
      restore: oc
        .route({
          method: "POST",
          path: "/admin/backups/restore",
          tags: ["Admin"],
          summary: "Restore from backup",
          description:
            "Upload a database backup file and restore it. A pre-restore backup is automatically created before overwriting the current database.",
        })
        .input(RestoreBackupInput)
        .output(z.void())
        .errors({
          BAD_REQUEST: {
            message: "Backup restoration failed",
            data: appErrorData(AppErrorCode.BACKUP_RESTORE_FAILED),
          },
        }),
      schedule: oc
        .route({
          method: "GET",
          path: "/admin/backups/schedule",
          tags: ["Admin"],
          summary: "Get backup schedule",
          description: "Fetch the current automated backup schedule configuration.",
          successDescription: "Backup schedule settings",
        })
        .output(BackupScheduleOutput),
      updateSchedule: oc
        .route({
          method: "PUT",
          path: "/admin/backups/schedule",
          tags: ["Admin"],
          summary: "Update backup schedule",
          description:
            "Update the automated backup schedule. Only provided fields are changed; omitted fields keep their current values.",
        })
        .input(UpdateScheduleInput)
        .output(z.void()),
    },
    triggerJob: oc
      .route({
        method: "POST",
        path: "/admin/jobs/trigger",
        tags: ["Admin"],
        summary: "Trigger cron job",
        description: "Manually trigger a background cron job by name. The job runs asynchronously.",
      })
      .input(TriggerJobInput)
      .output(TriggerJobOutput)
      .errors({
        NOT_FOUND: {
          message: "Job not found",
          data: appErrorData(AppErrorCode.JOB_NOT_FOUND),
        },
      }),
    purgeMetadataCache: oc
      .route({
        method: "POST",
        path: "/admin/cache/purge-metadata",
        tags: ["Admin"],
        summary: "Purge metadata cache",
        description:
          "Delete un-enriched stub titles not in any user's library and clean up orphaned person records.",
        successDescription: "Counts of deleted titles and persons",
      })
      .input(z.void())
      .output(PurgeMetadataCacheOutput),
    purgeImageCache: oc
      .route({
        method: "POST",
        path: "/admin/cache/purge-images",
        tags: ["Admin"],
        summary: "Purge image cache",
        description:
          "Delete all cached TMDB images from disk. Images will be re-downloaded on demand.",
        successDescription: "Count of deleted files and bytes freed",
      })
      .input(z.void())
      .output(PurgeImageCacheOutput),
    systemHealth: oc
      .route({
        method: "GET",
        path: "/admin/system-health",
        tags: ["Admin"],
        summary: "Get system health report",
        description:
          "Comprehensive health check covering database, TMDB connectivity, cron jobs, image cache, backups, and environment.",
        successDescription: "Full system health report",
      })
      .output(SystemHealthOutput),
  },

  // ─── Imports ────────────────────────────────────────────────
  imports: {
    parseFile: oc
      .route({
        method: "POST",
        path: "/imports/parse-file",
        tags: ["Imports"],
        summary: "Parse import file",
        description:
          "Upload and parse an export file from Trakt, Simkl, Letterboxd, or Sofa. Returns a preview of items found without importing anything.",
        successDescription: "Preview of importable items with counts",
      })
      .input(ParseFileInput)
      .output(ImportPreviewSchema)
      .errors({
        BAD_REQUEST: {
          message: "Invalid import file",
          data: appErrorData(AppErrorCode.IMPORT_INVALID_FILE),
        },
      }),
    parsePayload: oc
      .route({
        method: "POST",
        path: "/imports/parse-payload",
        tags: ["Imports"],
        summary: "Parse raw OAuth import data",
        description:
          "Accept raw API responses from the OAuth proxy, parse them into normalized import format, and return a preview with item counts.",
        successDescription: "Preview of importable items with counts",
      })
      .input(ParsePayloadInput)
      .output(ImportPreviewSchema),
    createJob: oc
      .route({
        method: "POST",
        path: "/imports/jobs",
        tags: ["Imports"],
        summary: "Create import job",
        description: "Create and start a background import job from previously parsed data.",
        successDescription: "Created import job",
      })
      .input(CreateImportJobInput)
      .output(ImportJobSchema)
      .errors({
        BAD_REQUEST: {
          message: "Import payload too large",
          data: appErrorData(AppErrorCode.IMPORT_PAYLOAD_TOO_LARGE),
        },
        CONFLICT: {
          message: "An import is already in progress",
          data: appErrorData(AppErrorCode.IMPORT_ALREADY_RUNNING),
        },
      }),
    getJob: oc
      .route({
        method: "GET",
        path: "/imports/jobs/{id}",
        tags: ["Imports"],
        summary: "Get import job status",
        description: "Get the current status and progress of an import job.",
        successDescription: "Current job state",
      })
      .input(IdParam)
      .output(ImportJobSchema),
    cancelJob: oc
      .route({
        method: "POST",
        path: "/imports/jobs/{id}/cancel",
        tags: ["Imports"],
        summary: "Cancel import job",
        description:
          "Cancel a pending or running import job. Already-imported items are not rolled back.",
        successDescription: "Updated job state",
      })
      .input(IdParam)
      .output(ImportJobSchema)
      .errors({
        BAD_REQUEST: {
          message: "Import cannot be cancelled",
          data: appErrorData(AppErrorCode.IMPORT_CANNOT_CANCEL),
        },
      }),
    jobEvents: oc
      .route({
        method: "GET",
        path: "/imports/jobs/{id}/events",
        tags: ["Imports"],
        summary: "Stream import job events",
        description:
          "SSE stream of import job progress events. Yields progress updates and a final complete event.",
        successDescription: "Stream of job progress events",
      })
      .input(IdParam)
      .output(eventIterator(ImportJobEvent)),
  },
};
