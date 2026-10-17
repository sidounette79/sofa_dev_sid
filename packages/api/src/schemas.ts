import { z } from "zod";

// ─── Shared input schemas ─────────────────────────────────────

export const QuickEpisodeActionOutput = z
  .object({
    id: z.string().describe("Episode ID"),
    seasonNumber: z.number().describe("Season number"),
    episodeNumber: z.number().describe("Episode number"),
  })
  .nullable()
  .describe("The episode that was marked/unmarked, or null if there was nothing to change");
export const IdParam = z.object({
  id: z.string().min(1).describe("Internal UUIDv7 identifier"),
});
export const ProviderParam = z.object({
  provider: z.enum(["jellyfin", "emby", "sonarr", "radarr"]).describe("Media server provider type"),
});
export const FilenameParam = z.object({
  filename: z.string().min(1).describe("Backup filename"),
});
export const MediaTypeParam = z.object({
  type: z.enum(["movie", "tv"]).describe("Media type filter"),
});
export const OptionalMediaTypeParam = z.object({
  type: z.enum(["movie", "tv"]).optional().describe("Media type filter — omit for both"),
});
export const TrendingTypeParam = z.object({
  type: z.enum(["all", "movie", "tv"]).describe("Trending category: all, movie, or tv"),
  // 17.10, Sid: "après tendance du jour, la tendance de la semaine" — same
  // procedure, TMDB's own day/week split (getTrending already took this as
  // a param, just never exposed past the server). Defaults to "day" so
  // every existing caller (web, native) keeps its current behaviour.
  timeWindow: z.enum(["day", "week"]).default("day").describe("TMDB trending window"),
});
// ─── Pagination ──────────────────────────────────────────────

/** Page param for TMDB-backed endpoints (fixed ~20 items/page from TMDB) */
export const PageParam = z.object({
  page: z.number().int().min(1).max(500).default(1).describe("Page number (1-indexed)"),
});

/** Page + limit for locally-paginated endpoints */
export const PaginatedInput = z.object({
  page: z.number().int().min(1).max(500).default(1).describe("Page number (1-indexed)"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Results per page (1-100, default 20)"),
});

export const PaginationMeta = z.object({
  page: z.number().describe("Current page number"),
  totalPages: z.number().describe("Total number of pages available"),
  totalResults: z.number().describe("Total number of results across all pages"),
});

// ─── Title inputs ──────────────────────────────────────────────

export const UpdateStatusInput = z
  .object({
    id: z.string().min(1).describe("Title ID"),
    status: z
      .enum(["watchlist", "dropped"])
      .nullable()
      .describe(
        "Set to watchlist to add to library, dropped to mark as abandoned, or null to remove. Other transitions happen via watch endpoints.",
      ),
  })
  .meta({ description: "Add a title to the user's watchlist or remove from library" });

export const UpdateRatingInput = z
  .object({
    id: z.string().min(1).describe("Title ID"),
    stars: z.number().int().min(0).max(5).describe("Star rating from 0 (clear) to 5"),
  })
  .meta({ description: "Set or clear a star rating for a title" });

export const WatchScope = z
  .enum(["movie", "episode", "season", "series"])
  .describe("What the IDs refer to: movie title, episode, season, or entire TV series");

export const WatchInput = z
  .object({
    scope: WatchScope,
    ids: z.array(z.string().min(1)).min(1).describe("IDs to mark as watched"),
  })
  .meta({ description: "Mark one or more items as watched" });

export const UnwatchInput = z
  .object({
    scope: WatchScope,
    ids: z.array(z.string().min(1)).min(1).describe("IDs to unwatch"),
  })
  .meta({ description: "Remove watch records for one or more items" });

// ─── Search / Discover inputs ──────────────────────────────────

export const SearchInput = z
  .object({
    query: z.string().min(1).max(200).describe("Search query text"),
    type: z
      .enum(["movie", "tv", "person"])
      .optional()
      .describe("Optional type filter to narrow results"),
  })
  .merge(PageParam)
  .meta({ description: "Search query with optional type filter" });

export const DiscoverInput = z
  .object({
    type: z.enum(["movie", "tv"]).describe("Media type to discover"),
    genreId: z.number().int().optional().describe("TMDB genre ID to filter by"),
    yearMin: z.number().int().min(1900).max(2100).optional().describe("Minimum release year"),
    yearMax: z.number().int().min(1900).max(2100).optional().describe("Maximum release year"),
    ratingMin: z.number().min(0).max(10).optional().describe("Minimum TMDB vote average"),
    sortBy: z
      .enum([
        "popularity.desc",
        "vote_average.desc",
        "primary_release_date.desc",
        "primary_release_date.asc",
      ])
      .optional()
      .describe("Sort order for results"),
    language: z
      .string()
      .length(2)
      .regex(/^[a-z]{2}$/)
      .optional()
      .describe("ISO 639-1 original language code"),
    platformId: z.string().optional().describe("Platform ID to filter by"),
  })
  .merge(PageParam)
  .meta({ description: "Genre-based discovery filters" });

// ─── Watch history input ──────────────────────────────────────

export const WatchHistoryInput = z
  .object({
    type: z.enum(["movie", "episode"]).describe("What to count: movie watches or episode watches"),
    period: z
      .enum(["today", "this_week", "this_month", "this_year"])
      .describe("Time range for the histogram"),
  })
  .meta({ description: "Filters for watch history chart data" });

// ─── Integration inputs ────────────────────────────────────────

export const CreateIntegrationInput = z
  .object({
    provider: z
      .enum(["jellyfin", "emby", "sonarr", "radarr"])
      .describe("Media server provider to integrate"),
    enabled: z
      .boolean()
      .optional()
      .describe("Whether the integration starts enabled (default: true)"),
  })
  .meta({ description: "Create a new media server integration" });

export const UpdateEmbyUsernameInput = z
  .object({
    provider: z.literal("emby").describe("Provider type (always emby for this endpoint)"),
    embyUsername: z.string().nullable().describe("Emby username to link, or null to unlink"),
  })
  .meta({ description: "Link an Emby username to filter Now Playing sessions" });

export const UpdateEmbyLibrariesInput = z
  .object({
    libraryNames: z.array(z.string()).describe("Emby library names to claim as this user's own"),
  })
  .meta({
    description:
      "Set which Emby libraries belong to this user — matched titles are auto-added to their watchlist",
  });

export const EmbyLibrariesListOutput = z
  .object({
    libraries: z
      .array(z.string())
      .describe("Available Emby library names, excluding excluded ones"),
    selected: z.array(z.string()).describe("Library names currently claimed by this user"),
  })
  .meta({ description: "Available Emby libraries and this user's current selection" });

// ─── Admin inputs ──────────────────────────────────────────────

export const AdminSettingsOutput = z
  .object({
    registration: z.object({
      open: z.boolean().describe("Whether new user registration is open"),
    }),
    updateCheck: z.object({
      enabled: z.boolean().describe("Whether automatic update checks are enabled"),
      updateAvailable: z.boolean().nullable().describe("Whether a newer version is available"),
      currentVersion: z.string().nullable().describe("Currently running version"),
      latestVersion: z.string().nullable().describe("Latest available version"),
      releaseUrl: z.string().nullable().describe("URL to the latest release page"),
      lastCheckedAt: z.string().nullable().describe("When the last check was performed (ISO 8601)"),
    }),
  })
  .meta({ description: "Combined admin settings for registration and update checks" });

export const AdminSettingsUpdateInput = z
  .object({
    registration: z
      .object({ open: z.boolean().describe("Whether new user registration is allowed") })
      .optional(),
    updateCheck: z
      .object({ enabled: z.boolean().describe("Whether automatic update checks are enabled") })
      .optional(),
  })
  .meta({ description: "Partial update to admin settings" });

const cronJobName = z.enum([
  "scheduledBackup",
  "nightlyRefreshLibrary",
  "refreshAvailability",
  "refreshRecommendations",
  "refreshTvChildren",
  "cacheImages",
  "refreshCredits",
  "scanEmbyLibrary",
  "syncRequestedFromRadarrSonarr",
  "updateCheck",
  "optimizeDb",
  "refreshTitleEpisodeStats",
]);

export const TriggerJobInput = z
  .object({
    name: cronJobName.describe("Cron job to trigger"),
  })
  .meta({ description: "Specify which background job to trigger manually" });

const backupFrequency = z.enum(["6h", "12h", "1d", "7d"]).describe("Backup interval");

export const UpdateScheduleInput = z
  .object({
    enabled: z.boolean().optional().describe("Enable or disable scheduled backups"),
    frequency: backupFrequency.optional(),
    time: z
      .string()
      .regex(/^\d{2}:\d{2}$/, "Invalid time format")
      .refine(
        (t) => {
          const [h, m] = t.split(":").map(Number);
          return h >= 0 && h <= 23 && m >= 0 && m <= 59;
        },
        { message: "Invalid time value" },
      )
      .optional()
      .describe("Time of day to run backups (HH:MM, 24-hour format)"),
    dayOfWeek: z
      .number()
      .int()
      .min(0)
      .max(6)
      .optional()
      .describe("Day of week for weekly backups (0 = Sunday, 6 = Saturday)"),
    maxRetention: z
      .number()
      .int()
      .refine((n) => n === 0 || (n >= 1 && n <= 30), {
        message: "Max backups must be between 1 and 30, or 0 for unlimited",
      })
      .optional()
      .describe("Maximum number of backups to keep (0 = unlimited, 1-30 otherwise)"),
  })
  .meta({
    description: "Partial update to the automated backup schedule",
  });

// ─── Account inputs ────────────────────────────────────────────

export const UpdateNameInput = z.object({
  name: z.string().min(1).max(100).describe("New display name"),
});

export const PushSubscribeInput = z.object({
  endpoint: z.string().url().describe("Push service endpoint URL from the browser subscription"),
  keys: z.object({
    p256dh: z.string().describe("Subscription's public key"),
    auth: z.string().describe("Subscription's auth secret"),
  }),
});

export const PushUnsubscribeInput = z.object({
  endpoint: z.string().url().describe("Push service endpoint URL to remove"),
});

export const UploadAvatarInput = z
  .file()
  .mime(["image/jpeg", "image/png", "image/webp", "image/gif"])
  .max(2 * 1024 * 1024, "File too large (max 2MB)");

export const UploadAvatarOutput = z.object({
  imageUrl: z.string().describe("URL of the uploaded avatar image"),
});

// ─── Backup inputs ─────────────────────────────────────────────

export const RestoreBackupInput = z.file().max(100 * 1024 * 1024, "File too large (max 100 MB)");

// ═══════════════════════════════════════════════════════════════
// Output schemas
// ═══════════════════════════════════════════════════════════════

// ─── Shared primitives ─────────────────────────────────────────

const mediaType = z.enum(["movie", "tv"]).describe("Media type");

export const ColorPaletteSchema = z
  .object({
    vibrant: z.string().nullable(),
    darkVibrant: z.string().nullable(),
    lightVibrant: z.string().nullable(),
    muted: z.string().nullable(),
    darkMuted: z.string().nullable(),
    lightMuted: z.string().nullable(),
  })
  .meta({
    description: "Extracted color palette from the title poster image (CSS hex values)",
  });

export const EpisodeSchema = z
  .object({
    id: z.string().describe("Episode ID"),
    episodeNumber: z.number().describe("Episode number within the season"),
    name: z.string().nullable().describe("Episode title"),
    overview: z.string().nullable().describe("Episode plot summary"),
    stillPath: z.string().nullable().describe("Episode still image path"),
    stillThumbHash: z
      .string()
      .nullable()
      .describe("ThumbHash blur placeholder for the still image"),
    airDate: z.string().nullable().describe("Original air date (ISO 8601)"),
    runtimeMinutes: z.number().nullable().describe("Episode runtime in minutes"),
  })
  .meta({ description: "A single TV episode" });

export const SeasonSchema = z
  .object({
    id: z.string().describe("Season ID"),
    seasonNumber: z.number().describe("Season number (0 for specials)"),
    name: z.string().nullable().describe("Season name"),
    episodes: z.array(EpisodeSchema).describe("Episodes in this season"),
  })
  .meta({ description: "A TV season with its episodes" });

export const AvailabilityOfferSchema = z
  .object({
    platformId: z.string().describe("Platform ID"),
    providerName: z.string().describe("Display name (e.g. Netflix, Hulu)"),
    logoPath: z.string().nullable().describe("Provider logo image path"),
    offerType: z.string().describe("Offer category: stream or purchase"),
    watchUrl: z.string().nullable().describe("Direct link to watch on this provider"),
    isUserSubscribed: z.boolean().describe("Whether the user subscribes to this platform"),
  })
  .meta({ description: "A streaming availability offer from a provider" });

export const PlatformSchema = z
  .object({
    id: z.string().describe("Platform ID"),
    name: z.string().describe("Display name"),
    tmdbProviderIds: z.array(z.number()).describe("TMDB provider IDs mapped to this platform"),
    logoPath: z.string().nullable().describe("Logo image path"),
    isSubscription: z
      .boolean()
      .describe("True for subscription services, false for purchase/rental stores"),
  })
  .meta({ description: "A streaming platform" });

export type Platform = z.infer<typeof PlatformSchema>;

export const PlatformsListOutput = z.object({
  platforms: z.array(PlatformSchema),
});

export const UserPlatformsOutput = z.object({
  platformIds: z.array(z.string()),
});

export const UpdateUserPlatformsInput = z.object({
  platformIds: z.array(z.string()).describe("List of platform IDs the user subscribes to"),
});

export const CastMemberSchema = z
  .object({
    id: z.string().describe("Credit ID"),
    personId: z.string().describe("Internal person ID"),
    name: z.string().describe("Person's name"),
    character: z.string().nullable().describe("Character name (for acting credits)"),
    department: z.string().describe("Department (e.g. Acting, Directing)"),
    job: z.string().nullable().describe("Job title (for crew credits)"),
    displayOrder: z.number().describe("Sort order in the credits list"),
    episodeCount: z.number().nullable().describe("Number of episodes (TV only)"),
    profilePath: z.string().nullable().describe("Profile photo image path"),
    profileThumbHash: z
      .string()
      .nullable()
      .describe("ThumbHash blur placeholder for the profile photo"),
    tmdbId: z.number().describe("TMDB person ID"),
  })
  .meta({ description: "A cast or crew member credit" });

export const ResolvedTitleSchema = z
  .object({
    id: z.string().describe("Internal UUIDv7 identifier"),
    tmdbId: z.number().describe("TMDB numeric ID"),
    type: mediaType,
    title: z.string().describe("Display title (localized)"),
    originalTitle: z.string().nullable().describe("Original language title"),
    overview: z.string().nullable().describe("Plot synopsis"),
    releaseDate: z.string().nullable().describe("Theatrical release date (movies, ISO 8601)"),
    firstAirDate: z.string().nullable().describe("First air date (TV shows, ISO 8601)"),
    posterPath: z.string().nullable().describe("Poster image path"),
    posterThumbHash: z.string().nullable().describe("ThumbHash blur placeholder for the poster"),
    backdropPath: z.string().nullable().describe("Backdrop image path"),
    backdropThumbHash: z
      .string()
      .nullable()
      .describe("ThumbHash blur placeholder for the backdrop"),
    popularity: z.number().nullable().describe("TMDB popularity score"),
    voteAverage: z.number().nullable().describe("Average user rating (0-10)"),
    voteCount: z.number().nullable().describe("Total number of votes"),
    status: z.string().nullable().describe("Production status (e.g. Released, Returning Series)"),
    contentRating: z.string().nullable().describe("Content rating (e.g. PG-13, TV-MA)"),
    imdbId: z.string().nullable().describe("IMDb title ID (e.g. tt0137523)"),
    tvdbId: z.number().nullable().describe("TVDB ID (TV shows only)"),
    originalLanguage: z.string().nullable().describe("Original language ISO 639-1 code (e.g. en)"),
    runtimeMinutes: z.number().nullable().describe("Runtime in minutes (movies only)"),
    colorPalette: ColorPaletteSchema.nullable(),
    trailerVideoKey: z.string().nullable().describe("YouTube video key for the trailer"),
    genres: z.array(z.string()).describe("Genre names"),
    embyStatus: z
      .enum(["available", "removed"])
      .nullable()
      .describe(
        "Emby availability: 'available' (currently on the server), 'removed' (was on the server, no longer), or null (never seen)",
      ),
    embyLibraryName: z.string().nullable().describe("Emby library this title was found in"),
    embyItemId: z.string().nullable().describe("Emby item ID for deep-linking into the Emby app"),
  })
  .meta({ description: "A fully resolved movie or TV show from TMDB" });

export const PersonSchema = z
  .object({
    id: z.string().describe("Internal UUIDv7 identifier"),
    tmdbId: z.number().describe("TMDB person ID"),
    name: z.string().describe("Full name"),
    biography: z.string().nullable().describe("Biography text"),
    birthday: z.string().nullable().describe("Date of birth (ISO 8601)"),
    deathday: z.string().nullable().describe("Date of death (ISO 8601)"),
    placeOfBirth: z.string().nullable().describe("Place of birth"),
    profilePath: z.string().nullable().describe("Profile photo image path"),
    profileThumbHash: z
      .string()
      .nullable()
      .describe("ThumbHash blur placeholder for the profile photo"),
    knownForDepartment: z
      .string()
      .nullable()
      .describe("Primary department (e.g. Acting, Directing)"),
    imdbId: z.string().nullable().describe("IMDb person ID (e.g. nm0000123)"),
  })
  .meta({ description: "A person (actor, director, crew member) from TMDB" });

export const PersonCreditSchema = z
  .object({
    titleId: z.string().describe("Internal title ID"),
    tmdbId: z.number().describe("TMDB title ID"),
    type: mediaType,
    title: z.string().describe("Title name"),
    posterPath: z.string().nullable().describe("Poster image path"),
    posterThumbHash: z.string().nullable().describe("ThumbHash blur placeholder for the poster"),
    releaseDate: z.string().nullable().describe("Release date (ISO 8601)"),
    firstAirDate: z.string().nullable().describe("First air date (ISO 8601)"),
    voteAverage: z.number().nullable().describe("Average rating (0-10)"),
    character: z.string().nullable().describe("Character name (for acting credits)"),
    department: z.string().describe("Department (e.g. Acting, Directing)"),
    job: z.string().nullable().describe("Job title (for crew credits)"),
    embyStatus: z
      .enum(["available", "removed"])
      .nullable()
      .describe(
        "Emby availability: 'available' (currently on the server), 'removed' (was on the server, no longer), or null (never seen)",
      ),
    requestedAt: z.coerce.date().nullable().describe("When this title was requested, if ever"),
  })
  .meta({ description: "A person's credit in a movie or TV show" });

/** Reusable TMDB browse result (trending / popular / discover items) */
export const TmdbBrowseItem = z
  .object({
    id: z.string().describe("Internal title ID"),
    tmdbId: z.number().describe("TMDB numeric ID"),
    type: mediaType,
    title: z.string().describe("Display title"),
    posterPath: z.string().nullable().describe("Poster image path"),
    posterThumbHash: z.string().nullable().describe("ThumbHash blur placeholder for the poster"),
    releaseDate: z.string().nullable().describe("Release date (ISO 8601)"),
    firstAirDate: z.string().nullable().describe("First air date (ISO 8601)"),
    voteAverage: z.number().nullable().describe("Average rating (0-10)"),
    embyStatus: z
      .enum(["available", "removed"])
      .nullable()
      .describe(
        "Emby availability: 'available' (currently on the server), 'removed' (was on the server, no longer), or null (never seen)",
      ),
    // 28.08, Sid — real bug: every trending/popular/upcoming/browse handler
    // already attached requestedAt to each item, but this schema never
    // declared the field, so oRPC's Zod output validation silently stripped
    // it from every response (confirmed live: a title with requestedAt set
    // in the DB still came back with the key entirely absent, not even
    // null) — the "already requested" badge could never show outside the
    // one place (title detail page) that used a different schema.
    requestedAt: z.coerce
      .date()
      .nullable()
      .describe("When this title was requested, household-wide, or null if never requested"),
  })
  .meta({
    description: "A TMDB title card used in browse/trending/popular lists",
  });

/** Recommendation item (shared by title and dashboard recommendations) */
export const RecommendationItemSchema = z
  .object({
    id: z.string().describe("Internal title ID"),
    tmdbId: z.number().describe("TMDB numeric ID"),
    type: mediaType,
    title: z.string().describe("Display title"),
    posterPath: z.string().nullable().describe("Poster image path"),
    posterThumbHash: z.string().nullable().describe("ThumbHash blur placeholder for the poster"),
    releaseDate: z.string().nullable().describe("Release date (ISO 8601)"),
    firstAirDate: z.string().nullable().describe("First air date (ISO 8601)"),
    voteAverage: z.number().nullable().describe("Average rating (0-10)"),
    embyStatus: z
      .enum(["available", "removed"])
      .nullable()
      .describe("Emby availability, title-level — see library.ts's deriveEmbyStatus"),
    requestedAt: z.coerce
      .date()
      .nullable()
      .describe("When this title was requested, household-wide, or null if never requested"),
  })
  .meta({ description: "A recommended title" });

const displayStatusEnum = z.enum(["in_watchlist", "watching", "caught_up", "completed", "dropped"]);

const userStatusMap = z
  .record(z.string(), displayStatusEnum)
  .describe("Map of title ID to the user's display status");
const episodeProgressMap = z
  .record(z.string(), z.object({ watched: z.number(), total: z.number() }))
  .describe("Map of title ID to episode watch progress");

/** Standard browse response shape (popular, discover) */
const BrowseOutput = z
  .object({
    items: z.array(TmdbBrowseItem),
    userStatuses: userStatusMap,
    episodeProgress: episodeProgressMap,
  })
  .merge(PaginationMeta)
  .meta({
    description: "Browse results with user tracking statuses and episode progress",
  });

// ─── Title outputs ─────────────────────────────────────────────

export const TitleDetailOutput = z
  .object({
    title: ResolvedTitleSchema,
    seasons: z.array(SeasonSchema).describe("TV seasons (empty for movies)"),
    availability: z.array(AvailabilityOfferSchema).describe("Streaming availability offers"),
    cast: z.array(CastMemberSchema).describe("Cast and crew credits"),
    embyServerId: z
      .string()
      .nullable()
      .describe("Emby server ID for deep-linking, or null if not on Emby / not configured"),
    embyUrl: z
      .string()
      .nullable()
      .describe("Public Emby URL for web fallback deep-linking, or null if not configured"),
  })
  .meta({
    description: "Full title details with seasons, cast, and streaming availability",
  });

export const PendingLibraryOutput = z
  .object({
    rootFolderPath: z
      .string()
      .nullable()
      .describe(
        "The Radarr/Sonarr root folder already assigned to this request, or null if not requested / not found there / Radarr-Sonarr unreachable",
      ),
  })
  .meta({ description: "Where a requested-but-not-available title will land once received" });

export const UserInfoOutput = z
  .object({
    status: displayStatusEnum
      .nullable()
      .describe("User's display status, or null if not in library"),
    rating: z.number().nullable().describe("User's star rating (0-5), or null if unrated"),
    episodeWatches: z.array(z.string()).describe("IDs of episodes the user has watched"),
    rewatchedEpisodeIds: z
      .array(z.string())
      .describe("IDs of episodes watched in 2+ distinct rewatch cycles"),
    requestedAt: z.coerce
      .date()
      .nullable()
      .describe("When this title was requested via Radarr/Sonarr, or null if never requested"),
    embyStatus: z
      .enum(["available", "removed"])
      .nullable()
      .describe(
        "Emby availability: 'available' (currently on the server), 'removed' (was on the server, no longer), or null (never seen) — title-level, not scoped to this user",
      ),
  })
  .meta({
    description: "The current user's tracking info for a title",
  });

export const TitleRecommendationsOutput = z
  .object({
    recommendations: z.array(RecommendationItemSchema),
    userStatuses: userStatusMap,
  })
  .meta({
    description: "Recommended titles with the user's statuses",
  });

// ─── People outputs ────────────────────────────────────────────

export const PersonDetailOutput = z
  .object({
    person: PersonSchema,
    filmography: z.array(PersonCreditSchema).describe("Credits for this person (paginated)"),
    userStatuses: userStatusMap,
  })
  .merge(PaginationMeta)
  .meta({
    description: "Person profile with paginated filmography and user's statuses for their titles",
  });

// ─── Dashboard outputs ─────────────────────────────────────────

export const LibraryStatsOutput = z
  .object({
    size: z.number().describe("Total titles in the user's library"),
    completed: z.number().describe("Total titles with completed status"),
  })
  .meta({ description: "Aggregate library statistics" });
const StatusCountsSchema = z.object({
  in_watchlist: z.number(),
  watching: z.number(),
  caught_up: z.number(),
  completed: z.number(),
  dropped: z.number(),
});
export const LibraryStatisticsOutput = z
  .object({
    librarySize: z.number().describe("Total titles tracked by the user"),
    totalMoviesWatched: z.number().describe("All-time count of movie watches"),
    totalEpisodesWatched: z.number().describe("All-time count of episode watches"),
    mediaTypeDistribution: z
      .object({ movie: z.number(), tv: z.number() })
      .describe("Count of titles by media type"),
    statusDistribution: StatusCountsSchema.describe(
      "Count of titles by display status, across all media types",
    ),
    statusByType: z
      .object({ movie: StatusCountsSchema, tv: StatusCountsSchema })
      .describe("Count of titles by display status, split by media type"),
    averageRating: z.number().nullable().describe("Average user star rating (1-5), or null"),
    ratedCount: z.number().describe("Number of titles the user has rated"),
    percentRated: z.number().describe("Percentage of the library that has been rated"),
    totalWatchTimeMinutes: z
      .object({ movie: z.number(), tv: z.number() })
      .describe("All-time watch time in minutes, by media type — every watch counted separately"),
    genreStats: z
      .array(z.object({ name: z.string(), count: z.number() }))
      .describe("Genres of watched (completed/in-progress) titles, ranked by count"),
  })
  .meta({ description: "Extended library statistics for the statistics page" });

export const ContinueWatchingInput = z.object({
  sortBy: z.enum(["watched", "aired"]).default("watched").describe("Sort field"),
  sortDirection: z.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
});

export const ContinueWatchingOutput = z
  .object({
    items: z.array(
      z
        .object({
          title: z.object({
            id: z.string().describe("Title ID"),
            title: z.string().describe("Display title"),
            type: z.string().describe("Title type (always tv here)"),
            posterPath: z.string().nullable().describe("Poster image path"),
            posterThumbHash: z
              .string()
              .nullable()
              .describe("ThumbHash blur placeholder for the poster"),
            backdropPath: z.string().nullable().describe("Backdrop image path"),
            backdropThumbHash: z
              .string()
              .nullable()
              .describe("ThumbHash blur placeholder for the backdrop"),
            firstAirDate: z.string().nullable().describe("First air date"),
            status: z.string().nullable().describe("TMDB series status"),
            voteAverage: z.number().nullable().describe("TMDB vote average"),
            embyStatus: z
              .enum(["available", "removed"])
              .nullable()
              .describe("Availability on the user's Emby server"),
            watchCount: z.number().describe("Total watch-throughs, 1 = never rewatched"),
          }),
          nextEpisode: z
            .object({
              seasonNumber: z.number().describe("Season number"),
              episodeNumber: z.number().describe("Episode number"),
              name: z.string().nullable().describe("Episode title"),
              stillPath: z.string().nullable().describe("Episode still image path"),
              stillThumbHash: z
                .string()
                .nullable()
                .describe("ThumbHash blur placeholder for the still"),
              embyItemId: z
                .string()
                .nullable()
                .describe("Emby item ID for this specific episode, for deep-linking"),
            })
            .nullable()
            .describe("Next unwatched episode, or null if all caught up"),
          totalEpisodes: z.number().describe("Total episodes across all seasons"),
          watchedEpisodes: z.number().describe("Episodes the user has watched"),
          lastWatchedAt: z
            .string()
            .nullable()
            .describe("ISO date of the most recently watched episode"),
          lastAiredAt: z
            .string()
            .nullable()
            .describe("ISO date of the most recently aired episode"),
        })
        .meta({ description: "An in-progress show with watch progress" }),
    ),
    embyServerId: z
      .string()
      .nullable()
      .describe("Emby server ID for deep-linking, or null if not configured"),
    embyUrl: z
      .string()
      .nullable()
      .describe("Public Emby URL for web fallback deep-linking, or null if not configured"),
  })
  .meta({
    description: "TV shows the user is currently watching with next episode info",
  });
export const NowPlayingOutput = z
  .object({
    items: z.array(
      z
        .object({
          sessionId: z.string().describe("Emby session ID"),
          userName: z.string().nullable().describe("Emby user currently playing"),
          titleId: z.string().nullable().describe("Matched Sofa title ID, if found"),
          type: z.enum(["movie", "tv"]).describe("Media type"),
          title: z.string().describe("Movie title or TV series name"),
          posterPath: z.string().nullable().describe("Poster image path"),
          posterThumbHash: z
            .string()
            .nullable()
            .describe("ThumbHash blur placeholder for the poster"),
          episodeName: z.string().nullable().describe("Episode title, for TV only"),
          seasonNumber: z.number().nullable().describe("Season number, for TV only"),
          episodeNumber: z.number().nullable().describe("Episode number, for TV only"),
          progressPercent: z.number().describe("Playback progress, 0-100"),
          isPaused: z.boolean().describe("Whether playback is currently paused"),
        })
        .meta({ description: "A currently playing Emby session" }),
    ),
  })
  .meta({ description: "Currently playing sessions from Emby, for live dashboard display" });

// ─── Library (filtered) ───────────────────────────────────────

export const LibraryListInput = z
  .object({
    search: z.string().max(200).optional().describe("Search within library by title name"),
    statuses: z
      .array(displayStatusEnum)
      .optional()
      .describe("Filter by display statuses (multi-select)"),
    type: z.enum(["movie", "tv"]).optional().describe("Filter by media type"),
    genreId: z.number().int().optional().describe("Filter by TMDB genre ID"),
    ratingMin: z.number().int().min(1).max(5).optional().describe("Minimum user star rating"),
    ratingMax: z.number().int().min(1).max(5).optional().describe("Maximum user star rating"),
    yearMin: z.number().int().min(1900).max(2100).optional().describe("Minimum release year"),
    yearMax: z.number().int().min(1900).max(2100).optional().describe("Maximum release year"),
    contentRating: z.string().optional().describe("Content rating filter (e.g. PG-13, TV-MA)"),
    onMyServices: z
      .boolean()
      .optional()
      .describe("Only show titles available on the user's streaming services"),
    sortBy: z
      .enum([
        "title",
        "added_at",
        "release_date",
        "popularity",
        "user_rating",
        "vote_average",
        "next_air_date",
        "last_watched",
      ])
      .default("added_at")
      .describe("Sort field"),
    sortDirection: z.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
  })
  .merge(PaginatedInput)
  .meta({ description: "Filters, sorting, and pagination for the library" });

export const LibraryListOutput = z
  .object({
    items: z.array(
      z
        .object({
          id: z.string().describe("Title ID"),
          tmdbId: z.number().describe("TMDB numeric ID"),
          type: mediaType,
          title: z.string().describe("Display title"),
          posterPath: z.string().nullable().describe("Poster image path"),
          posterThumbHash: z
            .string()
            .nullable()
            .describe("ThumbHash blur placeholder for the poster"),
          releaseDate: z.string().nullable().describe("Release date (ISO 8601)"),
          firstAirDate: z.string().nullable().describe("First air date (ISO 8601)"),
          status: z.string().nullable().describe("Production status (e.g. Ended, Canceled)"),
          voteAverage: z.number().nullable().describe("Average rating (0-10)"),
          embyStatus: z
            .enum(["available", "removed"])
            .nullable()
            .describe(
              "Emby availability: 'available' (currently on the server), 'removed' (was on the server, no longer), or null (never seen)",
            ),
          userStatus: displayStatusEnum.nullable().describe("User's display status"),
          userRating: z.number().nullable().describe("User's star rating (1-5), or null"),
          episodeProgress: z
            .object({ watched: z.number(), total: z.number() })
            .nullable()
            .describe("Watched/total episode count for TV shows, or null"),
          watchCount: z
            .number()
            .nullable()
            .describe("Number of times this movie has been watched, or null for TV"),
        })
        .meta({ description: "A library item with user status and rating" }),
    ),
  })
  .merge(PaginationMeta)
  .meta({ description: "Filtered and sorted library titles" });

export const LibraryGenresOutput = z
  .object({
    genres: z
      .array(z.object({ id: z.number(), name: z.string() }))
      .describe("Genres present in the user's library"),
  })
  .meta({ description: "Genres that exist in the user's library" });

export const DiscoverRecommendationsOutput = z
  .object({
    items: z.array(RecommendationItemSchema),
  })
  .meta({
    description: "Personalized title recommendations based on the user's library",
  });

export const UntrackedEmbyLibraryItemSchema = z
  .object({
    id: z.string().describe("Internal title ID"),
    tmdbId: z.number().describe("TMDB numeric ID"),
    type: mediaType,
    title: z.string().describe("Display title"),
    posterPath: z.string().nullable().describe("Poster image path"),
    posterThumbHash: z.string().nullable().describe("ThumbHash blur placeholder for the poster"),
    releaseDate: z.string().nullable().describe("Release date (ISO 8601)"),
    firstAirDate: z.string().nullable().describe("First air date (ISO 8601)"),
    voteAverage: z.number().nullable().describe("Average rating (0-10)"),
    embyLibraryName: z.string().nullable().describe("Emby library this title was found in"),
  })
  .meta({ description: "A title physically available on the Emby server, not yet tracked" });

export const RequestedNotAvailableItemSchema = z
  .object({
    id: z.string().describe("Internal title ID"),
    tmdbId: z.number().describe("TMDB numeric ID"),
    type: mediaType,
    title: z.string().describe("Display title"),
    posterPath: z.string().nullable().describe("Poster image path"),
    posterThumbHash: z.string().nullable().describe("ThumbHash blur placeholder for the poster"),
    releaseDate: z.string().nullable().describe("Release date (ISO 8601)"),
    firstAirDate: z.string().nullable().describe("First air date (ISO 8601)"),
    voteAverage: z.number().nullable().describe("Average rating (0-10)"),
    requestedAt: z.coerce.date().describe("When this title was requested"),
  })
  .meta({ description: "A requested title not yet available on Emby" });

export const RequestedNotAvailableOutput = z
  .object({
    items: z.array(RequestedNotAvailableItemSchema),
    totalResults: z
      .number()
      .describe("Real total count of matching titles, independent of the feed's item cap"),
  })
  .meta({ description: 'Requested titles not yet on Emby, for the "Demandé - pas dispo" section' });

export const UntrackedEmbyLibraryOutput = z
  .object({
    items: z.array(UntrackedEmbyLibraryItemSchema),
    totalResults: z
      .number()
      .describe("Real total count of matching titles, independent of the feed's item cap"),
  })
  .meta({
    description: "Titles available on the Emby server that the user hasn't tracked yet",
  });

// ─── Upcoming outputs ─────────────────────────────────────────

export const UpcomingInput = z
  .object({
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(90)
      .describe("How many days into the future to look"),
    limit: z.number().int().min(1).max(50).default(20).describe("Maximum items per page"),
    cursor: z.string().optional().describe("Pagination cursor"),
    mediaType: z
      .enum(["movie", "tv"])
      .optional()
      .describe("Filter to only movies or only TV episodes"),
    statusFilter: z
      .array(z.enum(["watching", "watchlist"]))
      .optional()
      .describe("Filter by user tracking status"),
  })
  .meta({ description: "Filters for the upcoming feed" });

export const UpcomingItemSchema = z
  .object({
    episodeId: z
      .string()
      .nullable()
      .describe("Episode ID (TV only, null for movies and collapsed batches)"),
    titleId: z.string().describe("Internal title ID"),
    titleName: z.string().describe("Display title"),
    titleType: z.enum(["movie", "tv"]).describe("Media type"),
    posterPath: z.string().nullable().describe("Poster image path"),
    posterThumbHash: z.string().nullable().describe("ThumbHash blur placeholder"),
    backdropPath: z.string().nullable().describe("Backdrop image path"),
    backdropThumbHash: z.string().nullable().describe("ThumbHash blur placeholder for backdrop"),
    seasonNumber: z.number().nullable().describe("Season number (TV only)"),
    episodeNumber: z.number().nullable().describe("Episode number (TV only)"),
    episodeName: z.string().nullable().describe("Episode title (TV only)"),
    episodeCount: z
      .number()
      .describe("Number of episodes (1 for single, >1 for collapsed batch drops)"),
    date: z.string().describe("Air date or release date (YYYY-MM-DD)"),
    userStatus: displayStatusEnum.describe("User's display status"),
    isNewSeason: z.boolean().describe("Whether this is a new season for a completed show"),
    streamingProvider: z
      .object({
        platformId: z.string(),
        providerName: z.string(),
        logoPath: z.string().nullable(),
      })
      .nullable()
      .describe("Primary streaming provider, or null"),
  })
  .meta({ description: "An upcoming episode or movie release" });

export const UpcomingOutput = z
  .object({
    items: z.array(UpcomingItemSchema),
    nextCursor: z
      .string()
      .nullable()
      .describe("Cursor for the next page, or null if no more items"),
    totalResults: z
      .number()
      .describe("Real total count of upcoming items in the date window, independent of `limit`"),
  })
  .meta({ description: "Upcoming episodes and movie releases for tracked titles" });

// ─── Explore outputs ───────────────────────────────────────────

export const TrendingOutput = z
  .object({
    items: z.array(TmdbBrowseItem).describe("Trending titles"),
    hero: z
      .object({
        id: z.string().describe("Internal title ID"),
        tmdbId: z.number().describe("TMDB numeric ID"),
        type: mediaType,
        title: z.string().describe("Display title"),
        overview: z.string().describe("Plot synopsis"),
        backdropPath: z.string().nullable().describe("Backdrop image path"),
        voteAverage: z.number().describe("Average rating (0-10)"),
      })
      .nullable()
      .describe("Featured hero title for the spotlight banner"),
    userStatuses: userStatusMap,
    episodeProgress: episodeProgressMap,
  })
  .merge(PaginationMeta)
  .meta({
    description: "Trending titles with hero spotlight and user statuses",
  });

export const PopularOutput = BrowseOutput;

export const GenresOutput = z
  .object({
    genres: z.array(
      z.object({
        id: z.number().describe("TMDB genre ID"),
        name: z.string().describe("Genre display name"),
      }),
    ),
  })
  .meta({ description: "Available genres for filtering" });

// ─── Search output ─────────────────────────────────────────────

export const SearchOutput = z
  .object({
    results: z.array(
      z
        .object({
          id: z
            .string()
            .optional()
            .describe("Internal title ID (present for movie/tv results, absent for people)"),
          tmdbId: z.number().describe("TMDB numeric ID"),
          type: z.enum(["movie", "tv", "person"]).describe("Result type"),
          title: z.string().describe("Title or person name"),
          overview: z.string().nullable().describe("Plot summary or null for people"),
          posterPath: z.string().nullable().describe("Poster image path (movies/TV)"),
          profilePath: z.string().nullable().describe("Profile photo path (people)"),
          releaseDate: z.string().nullable().describe("Release date (ISO 8601)"),
          popularity: z.number().nullable().describe("TMDB popularity score"),
          voteAverage: z.number().nullable().describe("Average rating (0-10)"),
          knownForDepartment: z.string().nullable().describe("Primary department (people only)"),
          knownFor: z
            .array(z.string())
            .nullable()
            .describe("Notable works (people only, up to 3 titles)"),
          userStatus: displayStatusEnum
            .nullable()
            .describe("User's display status, or null for people/untracked"),
          embyStatus: z
            .enum(["available", "removed"])
            .nullable()
            .describe(
              "Emby availability: 'available' (currently on the server), 'removed' (was on the server, no longer), or null (never seen)",
            ),
          // 28.08, Sid — same fix as TmdbBrowseItem: the handler already
          // attaches requestedAt, but it was never declared here either, so
          // it was silently stripped by output validation. See that
          // schema's comment for the full diagnosis.
          requestedAt: z.coerce
            .date()
            .nullable()
            .optional()
            .describe("When this title was requested, household-wide, or null/absent for people"),
        })
        .meta({ description: "A search result (movie, TV show, or person)" }),
    ),
  })
  .merge(PaginationMeta)
  .meta({ description: "Search results from TMDB" });

// ─── Discover output ───────────────────────────────────────────

export const DiscoverOutput = BrowseOutput;

// ─── Watch history output ──────────────────────────────────────

export const HistoryBucketSchema = z
  .object({
    bucket: z.string().describe("Time period label (e.g. date or week)"),
    count: z.number().describe("Number of watches in this bucket"),
  })
  .meta({ description: "A single time-bucketed watch count" });

export const WatchHistoryOutput = z
  .object({
    count: z.number().describe("Total watches in the selected period"),
    history: z.array(HistoryBucketSchema).describe("Watch counts bucketed by time period"),
  })
  .meta({ description: "Watch history with time-bucketed counts" });

// ─── System status output ──────────────────────────────────────

export const JobSchema = z
  .object({
    jobName: z.string().describe("Cron job identifier"),
    cronPattern: z.string().nullable().describe("Cron expression (e.g. 0 2 * * *)"),
    nextRunAt: z.string().nullable().describe("Next scheduled run (ISO 8601)"),
    lastRunAt: z.string().nullable().describe("Last run start time (ISO 8601)"),
    lastDurationMs: z.number().nullable().describe("Duration of last run in milliseconds"),
    lastStatus: z
      .enum(["running", "success", "error"])
      .nullable()
      .describe("Outcome of the last run"),
    lastError: z.string().nullable().describe("Error message from the last failed run"),
    isCurrentlyRunning: z.boolean().describe("Whether the job is currently executing"),
    disabled: z.boolean().describe("Whether the job is disabled"),
  })
  .meta({ description: "Status of a background cron job" });

export const SystemHealthSchema = z
  .object({
    database: z
      .object({
        dbSizeBytes: z.number().describe("SQLite database file size"),
        walSizeBytes: z.number().describe("WAL file size"),
        titleCount: z.number().describe("Total titles in database"),
        episodeCount: z.number().describe("Total episodes in database"),
        userCount: z.number().describe("Total registered users"),
      })
      .meta({ description: "Database size and record counts" }),
    tmdb: z
      .object({
        connected: z.boolean().describe("Whether TMDB API is reachable"),
        tokenValid: z.boolean().describe("Whether the API token is valid"),
        tokenConfigured: z.boolean().describe("Whether a token is set"),
        responseTimeMs: z.number().nullable().describe("TMDB API response time in milliseconds"),
        error: z.string().nullable().describe("Error message if connectivity check failed"),
      })
      .meta({ description: "TMDB API connectivity status" }),
    jobs: z.array(JobSchema).describe("Status of all cron jobs"),
    imageCache: z
      .object({
        enabled: z.boolean().describe("Whether image caching is enabled"),
        totalSizeBytes: z.number().describe("Total cache size on disk"),
        imageCount: z.number().describe("Total cached images"),
        categories: z
          .record(
            z.string(),
            z.object({
              count: z.number().describe("Images in this category"),
              sizeBytes: z.number().describe("Category size on disk"),
            }),
          )
          .describe("Breakdown by image category (posters, backdrops, etc.)"),
      })
      .meta({ description: "Image cache statistics" }),
    backups: z
      .object({
        lastBackupAt: z.string().nullable().describe("Last backup timestamp (ISO 8601)"),
        lastBackupAgeHours: z.number().nullable().describe("Hours since the last backup"),
        backupCount: z.number().describe("Total backup files"),
        totalSizeBytes: z.number().describe("Total size of all backups"),
      })
      .meta({ description: "Backup status and size information" }),
    environment: z
      .object({
        dataDir: z.string().describe("Configured data directory path"),
        dataDirWritable: z.boolean().describe("Whether the data directory is writable"),
        envVars: z
          .array(
            z.object({
              name: z.string().describe("Environment variable name"),
              value: z.string().nullable().describe("Current value (sensitive values are masked)"),
            }),
          )
          .describe("Relevant environment variable statuses"),
      })
      .meta({ description: "Server environment information" }),
    checkedAt: z.string().describe("When this health check was performed (ISO 8601)"),
  })
  .meta({
    description:
      "Comprehensive system health report covering database, TMDB, jobs, cache, backups, and environment",
  });

export const SystemStatusOutput = z
  .object({
    publicApiUrl: z.string().describe("Base URL of the centralized public API"),
  })
  .meta({
    description: "Internal system configuration for authenticated clients",
  });

export const SystemHealthOutput = SystemHealthSchema;

// ─── Integration outputs ───────────────────────────────────────

export const IntegrationSchema = z
  .object({
    id: z.string().describe("Integration ID"),
    provider: z.string().describe("Provider name (jellyfin, emby, etc.)"),
    type: z
      .enum(["webhook", "list"])
      .describe("Integration type: webhook (Jellyfin/Emby) or list (Sonarr/Radarr)"),
    token: z.string().describe("Webhook authentication token"),
    embyUsername: z
      .string()
      .nullable()
      .describe("Emby username linked to this account, used to filter Now Playing sessions"),
    enabled: z.boolean().describe("Whether the integration is active"),
    lastEventAt: z.string().nullable().describe("Last received event timestamp (ISO 8601)"),
    createdAt: z.string().describe("When the integration was created (ISO 8601)"),
  })
  .meta({ description: "A media server integration configuration" });

export const IntegrationEventSchema = z
  .object({
    id: z.string().describe("Event ID"),
    eventType: z.string().nullable().describe("Webhook event type"),
    mediaType: z.string().nullable().describe("Media type from the event"),
    mediaTitle: z.string().nullable().describe("Title from the event"),
    status: z.enum(["success", "ignored", "error"]).describe("Event processing outcome"),
    receivedAt: z.string().describe("When the event was received (ISO 8601)"),
  })
  .meta({ description: "A webhook or sync event from a media server" });

export const IntegrationsListOutput = z
  .object({
    integrations: z.array(
      IntegrationSchema.extend({
        recentEvents: z
          .array(IntegrationEventSchema)
          .describe("Last 10 events for this integration"),
      }),
    ),
  })
  .meta({
    description: "All integrations with their recent events",
  });

export const IntegrationOutput = IntegrationSchema;

// ─── Admin outputs ─────────────────────────────────────────────

export const BackupSchema = z
  .object({
    filename: z.string().describe("Backup filename on disk"),
    sizeBytes: z.number().describe("Backup file size in bytes"),
    createdAt: z.string().describe("When the backup was created (ISO 8601)"),
    source: z
      .enum(["manual", "scheduled", "pre-restore"])
      .describe("How the backup was created: manual, scheduled, or automatic pre-restore"),
  })
  .meta({ description: "A database backup file" });

export const BackupsListOutput = z
  .object({
    backups: z.array(BackupSchema),
  })
  .meta({ description: "All available database backups" });

export const BackupCreateOutput = BackupSchema;

export const BackupScheduleOutput = z
  .object({
    enabled: z.boolean().describe("Whether scheduled backups are enabled"),
    maxRetention: z.number().describe("Maximum backups to keep (0 = unlimited)"),
    frequency: backupFrequency,
    time: z.string().describe("Scheduled time (HH:MM, 24-hour format)"),
    dayOfWeek: z.number().describe("Day of week for weekly backups (0 = Sunday)"),
  })
  .meta({ description: "Automated backup schedule configuration" });

export const TriggerJobOutput = z.object({
  ok: z.literal(true).describe("Always true on success"),
});

export const PurgeMetadataCacheOutput = z
  .object({
    deletedTitles: z.number().describe("Number of un-enriched stub titles deleted"),
    deletedPersons: z.number().describe("Number of orphaned person records deleted"),
  })
  .meta({
    description: "Result of purging un-enriched metadata from the database",
  });

export const PurgeImageCacheOutput = z
  .object({
    deletedFiles: z.number().describe("Number of image files deleted from disk"),
    freedBytes: z.number().describe("Total bytes freed from disk"),
  })
  .meta({ description: "Result of purging the image cache from disk" });

// ─── System outputs ───────────────────────────────────────────

export const PublicInfoOutput = z
  .object({
    instanceId: z.string().describe("Unique instance identifier"),
    tmdbConfigured: z.boolean().describe("Whether TMDB API is configured"),
    userCount: z.number().describe("Number of registered users"),
    registrationOpen: z.boolean().describe("Whether new user registration is open"),
    posterUrls: z.array(z.string()).describe("Poster image URLs for the login screen collage"),
    oidcEnabled: z.boolean().describe("Whether OIDC/SSO login is available"),
    oidcProviderName: z
      .string()
      .nullable()
      .describe("Display name of the OIDC provider (e.g. Authelia, Keycloak)"),
    passwordLoginDisabled: z.boolean().describe("Whether password-based login is disabled"),
    vapidPublicKey: z
      .string()
      .nullable()
      .describe("VAPID public key for Web Push subscription, or null if push isn't configured"),
  })
  .meta({
    description: "Public instance information and authentication configuration",
  });

// ─── Imports ──────────────────────────────────────────────────

export const ImportSourceEnum = z
  .enum(["trakt", "simkl", "letterboxd", "sofa"])
  .describe("Service to import from");

export const ImportMovieSchema = z.object({
  tmdbId: z.number().optional(),
  imdbId: z.string().optional(),
  title: z.string(),
  year: z.number().optional(),
  watchedAt: z.string().datetime({ offset: true }).optional().describe("ISO 8601 timestamp"),
  watchedOn: z.string().date().optional().describe("YYYY-MM-DD date-only"),
});

export const ImportEpisodeSchema = z.object({
  showTmdbId: z.number().optional(),
  imdbId: z.string().optional(),
  tvdbId: z.number().optional(),
  showTitle: z.string().optional(),
  year: z.number().optional(),
  seasonNumber: z.number().int().min(0),
  episodeNumber: z.number().int().min(1),
  watchedAt: z.string().datetime({ offset: true }).optional(),
  watchedOn: z.string().date().optional(),
});

export const TitleStatusEnum = z.enum(["watchlist", "in_progress", "completed"]);

export const ImportWatchlistItemSchema = z.object({
  tmdbId: z.number().optional(),
  imdbId: z.string().optional(),
  tvdbId: z.number().optional(),
  title: z.string(),
  year: z.number().optional(),
  type: z.enum(["movie", "tv"]),
  status: TitleStatusEnum.optional().describe("Library status (default: watchlist)"),
  addedAt: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe("When the item was added to library"),
});

export const ImportRatingSchema = z.object({
  tmdbId: z.number().optional(),
  imdbId: z.string().optional(),
  tvdbId: z.number().optional(),
  title: z.string(),
  year: z.number().optional(),
  type: z.enum(["movie", "tv"]),
  rating: z.number().int().min(1).max(5).describe("Sofa 1-5 star rating"),
  ratedAt: z.string().datetime({ offset: true }).optional(),
  ratedOn: z.string().date().optional(),
});

export const NormalizedImportSchema = z.object({
  source: ImportSourceEnum,
  movies: z.array(ImportMovieSchema).max(50_000),
  episodes: z.array(ImportEpisodeSchema).max(50_000),
  watchlist: z.array(ImportWatchlistItemSchema).max(50_000),
  ratings: z.array(ImportRatingSchema).max(50_000),
});

export const ImportOptionsSchema = z.object({
  importWatches: z.boolean().describe("Import movie and episode watch history"),
  importWatchlist: z.boolean().describe("Import watchlist items"),
  importRatings: z.boolean().describe("Import ratings"),
});

export const ImportResultSchema = z.object({
  imported: z.number().describe("Items successfully imported"),
  skipped: z.number().describe("Items skipped (already exist)"),
  failed: z.number().describe("Items that failed to import"),
  errors: z.array(z.string()).describe("Error messages for failed items"),
  warnings: z.array(z.string()).describe("Non-fatal warnings"),
});

export const ImportPreviewSchema = z.object({
  data: NormalizedImportSchema,
  warnings: z.array(z.string()),
  stats: z.object({
    movies: z.number(),
    episodes: z.number(),
    watchlist: z.number(),
    ratings: z.number(),
  }),
  diagnostics: z
    .object({
      unresolved: z.number(),
      unsupported: z.number(),
    })
    .optional(),
  blockingErrors: z.array(z.string()).optional(),
});

export const ParseFileInput = z.object({
  source: ImportSourceEnum,
  file: z.file().max(100 * 1024 * 1024, "File too large (max 100 MB)"),
});

export const ParsePayloadInput = z.object({
  source: z.enum(["trakt", "simkl"]).describe("OAuth import provider"),
  rawPayload: z.unknown().describe("Raw aggregated API response from the OAuth proxy"),
});

export const ImportJobStatusEnum = z.enum(["pending", "running", "success", "error", "cancelled"]);

export const ImportJobSchema = z.object({
  id: z.string(),
  source: ImportSourceEnum,
  status: ImportJobStatusEnum,
  totalItems: z.number(),
  processedItems: z.number(),
  importedCount: z.number(),
  skippedCount: z.number(),
  failedCount: z.number(),
  currentMessage: z.string().nullable(),
  errors: z.array(z.string()),
  warnings: z.array(z.string()),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});

export const CreateImportJobInput = z.object({
  data: NormalizedImportSchema,
  options: ImportOptionsSchema,
});

export const ImportJobEvent = z.object({
  type: z.enum(["progress", "complete", "timeout"]),
  job: ImportJobSchema,
});

// ─── Sofa Export ─────────────────────────────────────────────

const SofaLibraryItemSchema = z.object({
  tmdbId: z.number(),
  title: z.string(),
  year: z.number().optional(),
  type: z.enum(["movie", "tv"]),
  status: TitleStatusEnum,
  addedAt: z.string().datetime({ offset: true }),
});

const SofaMovieWatchSchema = z.object({
  tmdbId: z.number(),
  title: z.string(),
  year: z.number().optional(),
  watchedAt: z.string().datetime({ offset: true }),
});

const SofaEpisodeWatchSchema = z.object({
  showTmdbId: z.number(),
  showTitle: z.string(),
  showYear: z.number().optional(),
  seasonNumber: z.number().int().min(0),
  episodeNumber: z.number().int().min(1),
  episodeName: z.string().optional(),
  watchedAt: z.string().datetime({ offset: true }),
});

const SofaRatingSchema = z.object({
  tmdbId: z.number(),
  title: z.string(),
  year: z.number().optional(),
  type: z.enum(["movie", "tv"]),
  rating: z.number().int().min(1).max(5),
  ratedAt: z.string().datetime({ offset: true }),
});

export const SofaExportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().datetime({ offset: true }),
  user: z.object({ name: z.string(), email: z.string() }),
  library: z.array(SofaLibraryItemSchema).max(50_000),
  movieWatches: z.array(SofaMovieWatchSchema).max(50_000),
  episodeWatches: z.array(SofaEpisodeWatchSchema).max(50_000),
  ratings: z.array(SofaRatingSchema).max(50_000),
});

export type SofaExport = z.infer<typeof SofaExportSchema>;

// ─── Media Requests (Radarr/Sonarr root-folder picker) ──────────────
const RootFolderSchema = z.object({ path: z.string().describe("Absolute path on the *arr host") });
const QualityProfileSchema = z.object({
  id: z.number().describe("Quality profile ID"),
  name: z.string().describe('Quality profile name (e.g. "HD-1080p")'),
});

export const RequestOptionsOutput = z
  .object({
    radarr: z.object({
      rootFolders: z.array(RootFolderSchema),
      qualityProfiles: z.array(QualityProfileSchema),
    }),
    sonarr: z.object({
      rootFolders: z.array(RootFolderSchema),
      qualityProfiles: z.array(QualityProfileSchema),
    }),
  })
  .meta({ description: "Root folders + quality profiles for the request dialog's dropdowns" });

const UserRequestDefaultsShape = {
  radarrRootFolder: z.string().nullable().describe("Default Radarr root folder for this user"),
  radarrQualityProfileId: z.number().nullable().describe("Default Radarr quality profile ID"),
  sonarrRootFolder: z.string().nullable().describe("Default Sonarr root folder for this user"),
  sonarrQualityProfileId: z.number().nullable().describe("Default Sonarr quality profile ID"),
};

export const UserRequestDefaultsOutput = z
  .object(UserRequestDefaultsShape)
  .meta({ description: "A user's default root folder + quality profile" });

export const AdminUserRequestDefaultsListOutput = z
  .object({
    items: z.array(z.object({ userId: z.string(), ...UserRequestDefaultsShape })),
  })
  .meta({ description: "Every user's stored request defaults (admin only)" });

export const SetUserRequestDefaultsInput = z
  .object({ userId: z.string().describe("Sofa user ID"), ...UserRequestDefaultsShape })
  .meta({ description: "Admin-only: set a user's default root folder + quality profile" });

export const RequestMovieInput = z
  .object({
    id: z.string().describe("Sofa title ID"),
    rootFolderPath: z.string().optional().describe("Falls back to the requesting user's default"),
    qualityProfileId: z.number().optional(),
  })
  .meta({ description: "Push a movie request to Radarr with an immediate search" });

export const RequestSeriesInput = z
  .object({
    id: z.string().describe("Sofa title ID"),
    rootFolderPath: z.string().optional().describe("Falls back to the requesting user's default"),
    qualityProfileId: z.number().optional(),
    seasonNumbers: z
      .array(z.number())
      .optional()
      .describe("Which seasons to monitor/download — omit to request every season"),
  })
  .meta({ description: "Push a series request to Sonarr with an immediate search" });

// 06.09, Sid — "En attente TMDB": persists regardless of the show's air
// date (unlike the date-bucketed Upcoming feed), same principle as
// Grimmory's "missing books" — until TheTVDB catches up and a plain
// "Request" (the poster's own + button) succeeds.
export const UnresolvedSeriesRequestsOutput = z
  .object({
    items: z.array(
      z.object({
        id: z.string().describe("Title ID"),
        type: z.literal("tv"),
        title: z.string(),
        posterPath: z.string().nullable(),
        posterThumbHash: z.string().nullable(),
        firstAirDate: z.string().nullable(),
        voteAverage: z.number().nullable(),
      }),
    ),
  })
  .meta({ description: "Series requested but not yet on TheTVDB, awaiting retry" });

// 15.10, Sid - "la potentielle page qui recenserait toutes les demandes en
// attente": deferred 30.08 in favor of tracking via Radarr/Sonarr tags,
// reopened at her explicit request now that requestedAt/requestedByUserId
// already exist on titles.
export const RequestedTitlesInput = z
  .object({
    pendingOnly: z
      .boolean()
      .default(true)
      .describe("true: only titles not yet available in Emby. false: every request ever made"),
    page: z.number().int().min(1).default(1),
    limit: z.number().int().min(1).max(100).default(40),
  })
  .meta({ description: "List titles that have been requested, optionally pending-only" });

export const RequestedTitlesOutput = z
  .object({
    items: z.array(
      z.object({
        id: z.string().describe("Title ID"),
        type: z.enum(["movie", "tv"]),
        title: z.string(),
        posterPath: z.string().nullable(),
        posterThumbHash: z.string().nullable(),
        releaseDate: z.string().nullable(),
        firstAirDate: z.string().nullable(),
        voteAverage: z.number().nullable(),
        requestedAt: z.coerce.date(),
        requestedByName: z
          .string()
          .nullable()
          .describe("Null for a reconciled, non-Sofa-originated request"),
        embyStatus: z
          .enum(["available", "removed"])
          .nullable()
          .describe(
            "Emby availability: 'available', 'removed', or null (never seen - still pending)",
          ),
      }),
    ),
    total: z.number().int(),
  })
  .meta({ description: "Requested titles, newest first" });

const PlaybackDeviceShape = {
  embyDeviceId: z.string().describe("Emby's stable device ID (Devices API ReportedDeviceId)"),
  embyDeviceName: z.string(),
};

export const AvailablePlaybackDevicesOutput = z
  .object({
    items: z.array(
      z.object({
        ...PlaybackDeviceShape,
        appName: z.string(),
        iconUrl: z.string().nullable(),
        lastActivityAt: z.string().nullable(),
      }),
    ),
  })
  .meta({ description: "Every device this user's Emby account has ever connected with" });

export const FavoritePlaybackDevicesOutput = z
  .object({
    items: z.array(
      z.object({
        ...PlaybackDeviceShape,
        online: z.boolean().describe("Whether this device currently has a live Emby session"),
        nowPlaying: z.string().nullable(),
      }),
    ),
  })
  .meta({ description: "This user's saved shortlist of playback devices" });

export const SetFavoritePlaybackDevicesInput = z
  .object({ devices: z.array(z.object(PlaybackDeviceShape)).max(5) })
  .meta({ description: "Replace this user's playback device shortlist" });

export const PlaybackActivityInput = z
  .object({
    limit: z.number().min(1).max(200).default(50),
    offset: z.number().min(0).default(0),
    userId: z.string().optional().describe("Real Emby user ID — filter to just this account"),
    search: z.string().optional().describe("Substring match on the item's name"),
  })
  .meta({ description: "Admin-only: query Emby's Playback Reporting activity log" });

export const PlaybackActivityOutput = z
  .object({
    items: z.array(
      z.object({
        date: z.string(),
        userId: z.string(),
        userName: z.string(),
        itemName: z.string(),
        itemType: z.string(),
        deviceName: z.string(),
        clientName: z.string(),
        playDurationSeconds: z.number(),
      }),
    ),
    total: z.number(),
  })
  .meta({ description: "A page of Emby's real playback activity log, independent of Sofa users" });

export const PlaybackReportingUsersOutput = z
  .object({ items: z.array(z.object({ userId: z.string(), userName: z.string() })) })
  .meta({ description: "Real Emby accounts that have at least one logged playback session" });

export const DismissPlaybackDeviceInput = z
  .object({ embyDeviceId: z.string() })
  .meta({ description: "Permanently hide a device from this user's availability picker" });

export const PlayOnDeviceInput = z
  .object({
    embyDeviceId: z.string(),
    titleId: z.string().optional().describe("Movie title ID — exactly one of titleId/episodeId"),
    episodeId: z.string().optional(),
  })
  .refine((v) => (v.titleId ? !v.episodeId : !!v.episodeId), {
    message: "Provide exactly one of titleId or episodeId",
  })
  .meta({ description: "Start playback of a movie or episode on another Emby session" });

// ═══════════════════════════════════════════════════════════════
// Inferred types — use these instead of hand-written interfaces
// ═══════════════════════════════════════════════════════════════

export type AvailabilityOffer = z.infer<typeof AvailabilityOfferSchema>;
export type BackupFrequency = z.infer<typeof backupFrequency>;
export type BackupInfo = z.infer<typeof BackupSchema>;
export type CastMember = z.infer<typeof CastMemberSchema>;
export type ColorPalette = z.infer<typeof ColorPaletteSchema>;
export type CronJobName = z.infer<typeof cronJobName>;
export type LibraryStats = z.infer<typeof LibraryStatsOutput>;
export type Episode = z.infer<typeof EpisodeSchema>;
export type HistoryBucket = z.infer<typeof HistoryBucketSchema>;
export type PersonCredit = z.infer<typeof PersonCreditSchema>;
export type RecommendationItem = z.infer<typeof RecommendationItemSchema>;
export type ResolvedPerson = z.infer<typeof PersonSchema>;
export type ResolvedTitle = z.infer<typeof ResolvedTitleSchema>;
export type Season = z.infer<typeof SeasonSchema>;
export type SystemHealthData = z.infer<typeof SystemHealthSchema>;
export type PaginationInfo = z.infer<typeof PaginationMeta>;
export type TimePeriod = z.infer<typeof WatchHistoryInput>["period"];
export type ImportJob = z.infer<typeof ImportJobSchema>;
export type NormalizedImport = z.infer<typeof NormalizedImportSchema>;
export type UpcomingItem = z.infer<typeof UpcomingItemSchema>;
export type AdminSettings = z.infer<typeof AdminSettingsOutput>;
export type WatchScopeType = z.infer<typeof WatchScope>;
