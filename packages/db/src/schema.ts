import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { v7 as uuidv7 } from "uuid";

// Helper for UUID primary keys
const uuidPk = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => uuidv7());

// ─── Better Auth tables ──────────────────────────────────────────────

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  role: text("role").default("user"),
  banned: boolean("banned").default(false),
  banReason: text("banReason"),
  banExpires: timestamp("banExpires", { mode: "date" }),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  impersonatedBy: text("impersonatedBy"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", { mode: "date" }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", { mode: "date" }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { mode: "date" }),
  updatedAt: timestamp("updatedAt", { mode: "date" }),
});

// ─── Genres ─────────────────────────────────────────────────────────

export const genres = pgTable("genres", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
});

export const titleGenres = pgTable(
  "titleGenres",
  {
    titleId: text("titleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    genreId: integer("genreId")
      .notNull()
      .references(() => genres.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("titleGenres_titleId_genreId").on(table.titleId, table.genreId),
    index("titleGenres_genreId").on(table.genreId),
  ],
);

// ─── App tables ──────────────────────────────────────────────────────

export const titles = pgTable(
  "titles",
  {
    id: uuidPk(),
    tmdbId: integer("tmdbId").notNull(),
    tvdbId: integer("tvdbId"),
    type: text("type", { enum: ["movie", "tv"] }).notNull(),
    title: text("title").notNull(),
    originalTitle: text("originalTitle"),
    overview: text("overview"),
    // French translation from TVDB, layered over TMDB's (usually English)
    // overview — series-level counterpart of episodes.overviewFr. Movies
    // don't get this yet: TMDB doesn't hand back a TVDB ID for movies the
    // way it does for TV shows (see tvdbId below), so there's no cheap
    // lookup to piggyback on.
    overviewFr: text("overviewFr"),
    releaseDate: text("releaseDate"),
    firstAirDate: text("firstAirDate"),
    posterPath: text("posterPath"),
    posterThumbHash: text("posterThumbHash"),
    backdropPath: text("backdropPath"),
    backdropThumbHash: text("backdropThumbHash"),
    popularity: real("popularity"),
    voteAverage: real("voteAverage"),
    voteCount: integer("voteCount"),
    status: text("status"),
    contentRating: text("contentRating"),
    imdbId: text("imdbId"),
    originalLanguage: text("originalLanguage"),
    runtimeMinutes: integer("runtimeMinutes"),
    colorPalette: text("colorPalette"),
    trailerVideoKey: text("trailerVideoKey"),
    lastFetchedAt: timestamp("lastFetchedAt", { mode: "date" }),
    // Set once hydrateFrenchEpisodeTranslations() has fetched this TV
    // show's episode list from TVDB (see packages/tvdb) — guards the lazy
    // per-title fetch so a show already checked isn't re-fetched on every
    // page load. Null for movies and for TV shows not yet hydrated.
    tvdbTranslatedAt: timestamp("tvdbTranslatedAt", { mode: "date" }),
    inEmbyLibrary: boolean("inEmbyLibrary").notNull().default(false),
    embyItemId: text("embyItemId"),
    embyLibraryName: text("embyLibraryName"),
    // Household-wide, not per-user (24.08, Sid — "neutre de toute
    // bibliothèque suivie", same principle as inEmbyLibrary above): whether
    // this title has been requested via Radarr/Sonarr, by anyone, through
    // Sofa's Request button OR reconciled from Radarr/Sonarr directly (see
    // media-requests-sync.ts) — someone in the house adding it straight in
    // Radarr should show the same "already requested" badge to everyone.
    // requestedByUserId is null for a reconciled (non-Sofa-originated) request.
    requestedAt: timestamp("requestedAt", { mode: "date" }),
    requestedByUserId: text("requestedByUserId").references(() => user.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    uniqueIndex("titles_tmdbId_type_unique").on(table.tmdbId, table.type),
    index("titles_type_releaseDate").on(table.type, table.releaseDate),
    index("titles_type_firstAirDate").on(table.type, table.firstAirDate),
    index("titles_lastFetchedAt").on(table.lastFetchedAt),
    index("titles_type_status_lastFetchedAt").on(table.type, table.status, table.lastFetchedAt),
    index("titles_inEmbyLibrary").on(table.inEmbyLibrary),
    // 17.09, Sid: real cause of the hourly Radarr/Sonarr sync job's 45s
    // block (confirmed via EXPLAIN QUERY PLAN: `SCAN titles` — a full scan
    // of 72k+ rows for every `getExistingTitlesByTvdbIds()` call, the only
    // one of the two lookups with no index at all on its column).
    index("titles_tvdbId").on(table.tvdbId),
    // Same shape, found right after — only 495 of 72,667 titles have
    // embyItemId set, but getMovieTitleIdsByEmbyItemId() (reconcileEmby-
    // WatchStatus, cron "35 */6 * * *") still had to scan every movie-type
    // row (55,429 of them) to find the ~312 that qualify — measured 74.8s.
    // Partial (not just indexed): a plain index on this column measurably
    // helped (74.8s -> ~1-16s depending on page-cache state) but SQLite's
    // planner kept preferring the existing (type,status,lastFetchedAt)
    // index over it even after ANALYZE — a partial index matching the
    // query's own `IS NOT NULL` predicate is tiny (495 rows) and SQLite
    // recognizes it as satisfying that predicate directly, not just as
    // another candidate to cost-estimate against the bigger one.
    index("titles_embyItemId")
      .on(table.embyItemId)
      .where(sql`${table.embyItemId} is not null`),
  ],
);

export const seasons = pgTable(
  "seasons",
  {
    id: uuidPk(),
    titleId: text("titleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    seasonNumber: integer("seasonNumber").notNull(),
    name: text("name"),
    overview: text("overview"),
    posterPath: text("posterPath"),
    posterThumbHash: text("posterThumbHash"),
    airDate: text("airDate"),
    lastFetchedAt: timestamp("lastFetchedAt", { mode: "date" }),
  },
  (table) => [uniqueIndex("seasons_titleId_seasonNumber").on(table.titleId, table.seasonNumber)],
);

// Web Push subscriptions (20.08, Sid: episode-release + series-status-change
// notifications). One row per device/browser — a user can have several
// (phone + tablet), each with its own endpoint from the browser's push
// service. `endpoint` is the natural unique key: the browser reissues a new
// one on re-subscribe, so there's no separate "still valid" flag here —
// `sendNotifications` (packages/core/src/push.ts) deletes a subscription
// outright the moment its push service returns 404/410 (gone).
export const pushSubscriptions = pgTable(
  "pushSubscriptions",
  {
    id: uuidPk(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    userAgent: text("userAgent"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
  },
  (table) => [index("pushSubscriptions_userId").on(table.userId)],
);

export const episodes = pgTable(
  "episodes",
  {
    id: uuidPk(),
    seasonId: text("seasonId")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    episodeNumber: integer("episodeNumber").notNull(),
    name: text("name"),
    overview: text("overview"),
    // French translation from TVDB, used as a fallback layer over the
    // (usually English) TMDB name/overview above — see packages/tvdb.
    // Null until hydrateFrenchEpisodeTranslations() has run for this show,
    // and stays null per-episode if TVDB itself has no French translation.
    nameFr: text("nameFr"),
    overviewFr: text("overviewFr"),
    stillPath: text("stillPath"),
    stillThumbHash: text("stillThumbHash"),
    airDate: text("airDate"),
    runtimeMinutes: integer("runtimeMinutes"),
    embyItemId: text("embyItemId"),
    // Set once the "new episode" push notification has been sent for this
    // episode (notifyNewEpisodes cron, packages/core/src/cron.ts) — a
    // persisted flag rather than a same-day check, so a re-run of the job
    // (or the job simply running more than once on release day) can't
    // double-notify.
    notifiedAt: timestamp("notifiedAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("episodes_seasonId_episodeNumber").on(table.seasonId, table.episodeNumber),
    index("episodes_airDate").on(table.airDate),
    // 17.09, Sid — same shape as titles.tvdbId (see
    // [[project_sofa_titles_tvdbid_missing_index]]): only 7,657 of 157,349
    // episodes have embyItemId set, but getEpisodesByEmbyItemId() (used by
    // reconcileEmbyWatchStatus, cron "35 */6 * * *") had to touch nearly
    // every row to find them — measured 17.3s. Partial for the same reason
    // as titles_embyItemId above.
    index("episodes_embyItemId")
      .on(table.embyItemId)
      .where(sql`${table.embyItemId} is not null`),
  ],
);

export const userTitleStatus = pgTable(
  "userTitleStatus",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    titleId: text("titleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    status: text("status", {
      enum: ["watchlist", "in_progress", "completed", "dropped"],
    }).notNull(),
    addedAt: timestamp("addedAt", { mode: "date" }).notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
    // TV rewatch cycle — starts at 1, incremented each time the user restarts
    // the series from scratch via "Watch Again". Episode watches are tagged
    // with the cycle active when watched (see userEpisodeWatches.cycle), so
    // past cycles stay in history instead of being wiped. Unused for movies,
    // which track rewatches as separate userMovieWatches rows instead.
    currentCycle: integer("currentCycle").notNull().default(1),
    // Superseded (24.08, same day) by titles.requestedAt — "already
    // requested" needed to be household-wide, not per-user (Sid: a request
    // made by someone else, or straight in Radarr/Sonarr, must show the same
    // badge to everyone). Column kept as-is (no migration to drop it), but
    // nothing writes to it anymore — do not read this one, use
    // titles.requestedAt/requestedByUserId instead.
    requestedAt: timestamp("requestedAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("userTitleStatus_userId_titleId").on(table.userId, table.titleId),
    index("userTitleStatus_userId_status").on(table.userId, table.status),
  ],
);

export const userMovieWatches = pgTable(
  "userMovieWatches",
  {
    id: uuidPk(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    titleId: text("titleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    watchedAt: timestamp("watchedAt", { mode: "date" }).notNull(),
    source: text("source", {
      enum: ["manual", "import", "jellyfin", "emby"],
    })
      .notNull()
      .default("manual"),
  },
  (table) => [
    index("userMovieWatches_userId_watchedAt").on(table.userId, table.watchedAt),
    index("userMovieWatches_titleId").on(table.titleId),
    index("userMovieWatches_userId_titleId").on(table.userId, table.titleId),
  ],
);

export const userEpisodeWatches = pgTable(
  "userEpisodeWatches",
  {
    id: uuidPk(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    episodeId: text("episodeId")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    watchedAt: timestamp("watchedAt", { mode: "date" }).notNull(),
    source: text("source", {
      enum: ["manual", "import", "jellyfin", "emby"],
    })
      .notNull()
      .default("manual"),
    // Matches userTitleStatus.currentCycle at the time this episode was
    // watched, so a rewatch (cycle 2+) doesn't collide with — or get
    // shadowed by — the previous watch-through's row for the same episode.
    cycle: integer("cycle").notNull().default(1),
  },
  (table) => [
    index("userEpisodeWatches_userId_watchedAt").on(table.userId, table.watchedAt),
    index("userEpisodeWatches_episodeId").on(table.episodeId),
    index("userEpisodeWatches_userId_episodeId").on(table.userId, table.episodeId),
    index("userEpisodeWatches_userId_episodeId_cycle").on(
      table.userId,
      table.episodeId,
      table.cycle,
    ),
  ],
);

export const userRatings = pgTable(
  "userRatings",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    titleId: text("titleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    ratingStars: integer("ratingStars").notNull(),
    ratedAt: timestamp("ratedAt", { mode: "date" }).notNull(),
  },
  (table) => [uniqueIndex("userRatings_userId_titleId").on(table.userId, table.titleId)],
);

// ─── Platforms & Availability ────────────────────────────────────────

export const platforms = pgTable("platforms", {
  id: uuidPk(),
  name: text("name").notNull(),
  logoPath: text("logoPath"),
  urlTemplate: text("urlTemplate"),
  isSubscription: boolean("isSubscription").notNull().default(true),
});

export const platformTmdbIds = pgTable(
  "platformTmdbIds",
  {
    platformId: text("platformId")
      .notNull()
      .references(() => platforms.id, { onDelete: "cascade" }),
    tmdbProviderId: integer("tmdbProviderId").notNull(),
  },
  (table) => [
    uniqueIndex("platformTmdbIds_tmdbProviderId_unique").on(table.tmdbProviderId),
    index("platformTmdbIds_platformId").on(table.platformId),
  ],
);

export const titleAvailability = pgTable(
  "titleAvailability",
  {
    titleId: text("titleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    platformId: text("platformId")
      .notNull()
      .references(() => platforms.id, { onDelete: "cascade" }),
    offerType: text("offerType", {
      enum: ["flatrate", "rent", "buy", "free", "ads"],
    }).notNull(),
    region: text("region").notNull().default("US"),
    lastFetchedAt: timestamp("lastFetchedAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("titleAvailability_unique").on(
      table.titleId,
      table.platformId,
      table.offerType,
      table.region,
    ),
    index("titleAvailability_titleId").on(table.titleId),
    index("titleAvailability_platformId").on(table.platformId),
  ],
);

export const userPlatforms = pgTable(
  "userPlatforms",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    platformId: text("platformId")
      .notNull()
      .references(() => platforms.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("userPlatforms_userId_platformId").on(table.userId, table.platformId),
    index("userPlatforms_userId").on(table.userId),
  ],
);

export const userEmbyLibraries = pgTable(
  "userEmbyLibraries",
  {
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    embyLibraryName: text("embyLibraryName").notNull(),
  },
  (table) => [
    uniqueIndex("userEmbyLibraries_userId_embyLibraryName").on(
      table.userId,
      table.embyLibraryName,
    ),
    index("userEmbyLibraries_embyLibraryName").on(table.embyLibraryName),
  ],
);

export const titleRecommendations = pgTable(
  "titleRecommendations",
  {
    titleId: text("titleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    recommendedTitleId: text("recommendedTitleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    source: text("source", {
      enum: ["tmdb_similar", "tmdb_recommendations"],
    }).notNull(),
    rank: integer("rank").notNull(),
    lastFetchedAt: timestamp("lastFetchedAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("titleRecommendations_unique").on(
      table.titleId,
      table.recommendedTitleId,
      table.source,
    ),
    index("titleRecommendations_titleId_rank").on(table.titleId, table.rank),
  ],
);

// ─── Persons & Cast ─────────────────────────────────────────────────

export const persons = pgTable(
  "persons",
  {
    id: uuidPk(),
    tmdbId: integer("tmdbId").notNull(),
    name: text("name").notNull(),
    biography: text("biography"),
    birthday: text("birthday"),
    deathday: text("deathday"),
    placeOfBirth: text("placeOfBirth"),
    profilePath: text("profilePath"),
    profileThumbHash: text("profileThumbHash"),
    knownForDepartment: text("knownForDepartment"),
    popularity: real("popularity"),
    imdbId: text("imdbId"),
    lastFetchedAt: timestamp("lastFetchedAt", { mode: "date" }),
    filmographyLastFetchedAt: timestamp("filmographyLastFetchedAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("persons_tmdbId_unique").on(table.tmdbId),
    index("persons_name").on(table.name),
  ],
);

export const titleCast = pgTable(
  "titleCast",
  {
    id: uuidPk(),
    titleId: text("titleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    personId: text("personId")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    character: text("character"),
    department: text("department").notNull().default("Acting"),
    job: text("job"),
    displayOrder: integer("displayOrder").notNull().default(0),
    episodeCount: integer("episodeCount"),
    lastFetchedAt: timestamp("lastFetchedAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("titleCast_unique").on(
      table.titleId,
      table.personId,
      table.department,
      table.character,
    ),
    index("titleCast_titleId_displayOrder").on(table.titleId, table.displayOrder),
    index("titleCast_personId").on(table.personId),
  ],
);

export const personFilmography = pgTable(
  "personFilmography",
  {
    id: uuidPk(),
    personId: text("personId")
      .notNull()
      .references(() => persons.id, { onDelete: "cascade" }),
    titleId: text("titleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    character: text("character"),
    department: text("department").notNull().default("Acting"),
    job: text("job"),
    displayOrder: integer("displayOrder").notNull().default(0),
  },
  (table) => [
    index("personFilmography_personId_displayOrder").on(table.personId, table.displayOrder),
    index("personFilmography_titleId").on(table.titleId),
  ],
);

// ─── Integrations ───────────────────────────────────────────────────

export const integrations = pgTable(
  "integrations",
  {
    id: uuidPk(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    type: text("type", { enum: ["webhook", "list"] }).notNull(),
    token: text("token").notNull().unique(),
    embyUsername: text("embyUsername"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
    lastEventAt: timestamp("lastEventAt", { mode: "date" }),
  },
  (table) => [
    uniqueIndex("integrations_userId_provider").on(table.userId, table.provider),
    uniqueIndex("integrations_token").on(table.token),
  ],
);

export const integrationEvents = pgTable(
  "integrationEvents",
  {
    id: uuidPk(),
    integrationId: text("integrationId")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    eventType: text("eventType"),
    mediaType: text("mediaType"),
    mediaTitle: text("mediaTitle"),
    status: text("status", {
      enum: ["success", "ignored", "error"],
    }).notNull(),
    errorMessage: text("errorMessage"),
    receivedAt: timestamp("receivedAt", { mode: "date" }).notNull(),
  },
  (table) => [
    index("integrationEvents_integrationId_receivedAt").on(table.integrationId, table.receivedAt),
  ],
);

// ─── Cron Run History ────────────────────────────────────────────────

export const cronRuns = pgTable(
  "cronRuns",
  {
    id: uuidPk(),
    jobName: text("jobName").notNull(),
    status: text("status", {
      enum: ["running", "success", "error"],
    }).notNull(),
    startedAt: timestamp("startedAt", { mode: "date" }).notNull(),
    finishedAt: timestamp("finishedAt", { mode: "date" }),
    durationMs: integer("durationMs"),
    errorMessage: text("errorMessage"),
  },
  (table) => [index("cronRuns_jobName_startedAt").on(table.jobName, table.startedAt)],
);

// ─── Import Jobs ────────────────────────────────────────────────────

export const importJobs = pgTable(
  "importJobs",
  {
    id: uuidPk(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    source: text("source", {
      enum: ["trakt", "simkl", "letterboxd", "sofa"],
    }).notNull(),
    status: text("status", {
      enum: ["pending", "running", "success", "error", "cancelled"],
    }).notNull(),
    payload: text("payload").notNull(),
    importWatches: boolean("importWatches").notNull(),
    importWatchlist: boolean("importWatchlist").notNull(),
    importRatings: boolean("importRatings").notNull(),
    totalItems: integer("totalItems").notNull().default(0),
    processedItems: integer("processedItems").notNull().default(0),
    importedCount: integer("importedCount").notNull().default(0),
    skippedCount: integer("skippedCount").notNull().default(0),
    failedCount: integer("failedCount").notNull().default(0),
    currentMessage: text("currentMessage"),
    errors: text("errors"),
    warnings: text("warnings"),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
    startedAt: timestamp("startedAt", { mode: "date" }),
    finishedAt: timestamp("finishedAt", { mode: "date" }),
  },
  (table) => [
    index("importJobs_userId_createdAt").on(table.userId, table.createdAt),
    index("importJobs_status").on(table.status),
    uniqueIndex("importJobs_active_user")
      .on(table.userId)
      .where(sql`${table.status} in ('pending', 'running')`),
  ],
);

// ─── App Settings ───────────────────────────────────────────────────

// ─── Radarr/Sonarr request defaults (per-user root folder + quality profile,
// Jellyseerr-style picker at watchlist-add time) ───────────────────────
export const userRequestDefaults = pgTable("userRequestDefaults", {
  userId: text("userId")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  radarrRootFolder: text("radarrRootFolder"),
  radarrQualityProfileId: integer("radarrQualityProfileId"),
  sonarrRootFolder: text("sonarrRootFolder"),
  sonarrQualityProfileId: integer("sonarrQualityProfileId"),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});

// ─── Playback devices (01.09, Sid: "Lire sur..." — remote-play an episode/
// movie directly on an Emby session, e.g. the living room TV's own native
// Emby app, without ever opening the Emby app herself) ─────────────────
// A household-wide Emby server has dozens of devices (every phone/tablet/TV
// that's ever connected, across every family member) — this is each user's
// own short list of 2-3 they actually want to see in the "Lire sur..."
// picker, not the full household device list every time.
export const userPlaybackDevices = pgTable(
  "userPlaybackDevices",
  {
    id: uuidPk(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Emby's own stable per-device ID (`/Devices` → ReportedDeviceId, same
    // value as a live session's `DeviceId`) — survives across sessions,
    // unlike a session ID which only exists while that device is actively
    // connected.
    embyDeviceId: text("embyDeviceId").notNull(),
    embyDeviceName: text("embyDeviceName").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("userPlaybackDevices_userId_embyDeviceId").on(table.userId, table.embyDeviceId),
    index("userPlaybackDevices_userId").on(table.userId),
  ],
);

// 01.09, Sid: her own Emby account alone had 57 devices (phones, old TV
// boxes, browser tabs, request bots...) going back over a year — a
// permanent per-user "hide this, I'll never want to see it again" so the
// availability picker actually shrinks over time instead of showing every
// device that's ever connected on every visit.
export const userDismissedPlaybackDevices = pgTable(
  "userDismissedPlaybackDevices",
  {
    id: uuidPk(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    embyDeviceId: text("embyDeviceId").notNull(),
    createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("userDismissedPlaybackDevices_userId_embyDeviceId").on(
      table.userId,
      table.embyDeviceId,
    ),
    index("userDismissedPlaybackDevices_userId").on(table.userId),
  ],
);

// ─── Unresolved series requests (06.09, Sid: "Les Évaporés" — a series
// TMDB already lists but TheTVDB hasn't indexed yet, since it hadn't aired
// at request time) ──────────────────────────────────────────────────────
// requestSeries() throws NoTvdbIdError for these instead of silently
// dropping the attempt — same principle as Grimmory's "missing books":
// surfaced back in the feed itself (Upcoming page) instead of a separate
// screen, with a Retry action once TheTVDB catches up. Upserted by
// (userId, titleId) — a repeated failed attempt just refreshes the reason/
// timestamp rather than piling up duplicates.
export const unresolvedSeriesRequests = pgTable(
  "unresolvedSeriesRequests",
  {
    id: uuidPk(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    titleId: text("titleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    requestedByName: text("requestedByName").notNull(),
    reason: text("reason").notNull(),
    // Stored so Retry can call requestSeries() again with the exact same
    // choices the user made originally.
    rootFolderPath: text("rootFolderPath"),
    qualityProfileId: integer("qualityProfileId"),
    seasonNumbers: text("seasonNumbers"), // JSON-encoded number[], null = every season
    createdAt: timestamp("createdAt", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("unresolvedSeriesRequests_userId_titleId").on(table.userId, table.titleId),
    index("unresolvedSeriesRequests_userId").on(table.userId),
  ],
);

// 18.09, Sid: "sofa c'est de nouveau lent... régulièrement long à l'ouverture"
// - `library/list`'s display-status filter (watching/caught_up/completed)
// used to compute aired/watched episode counts live, on every request, via
// a GROUP BY over the ENTIRE episodes table (157k+ rows, unscoped to the
// user's own tracked titles on purpose - scoping first was tried and
// measured slower, see the comment above episodeStatsSubquery in
// packages/db/src/queries/library.ts) - fine at a smaller catalog size, but
// grew past ~30s once the catalog reached this scale (a single show,
// "Plus belle la vie", added 4667 episodes the same day this was found).
// Precomputed here instead, by title-episode-stats-worker.ts on its own
// Worker thread (bun:sqlite is synchronous - computing this on the main
// thread, even periodically instead of per-request, would just trade one
// blocking pattern for another), refreshed every few minutes rather than
// on every page load. `getFilteredLibrary`'s needsDisplayStatus branch now
// reads this table with a plain indexed lookup instead of re-running the
// aggregation itself.
export const titleEpisodeStats = pgTable(
  "titleEpisodeStats",
  {
    id: uuidPk(),
    userId: text("userId")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    titleId: text("titleId")
      .notNull()
      .references(() => titles.id, { onDelete: "cascade" }),
    airedCount: integer("airedCount").notNull(),
    watchedCount: integer("watchedCount").notNull(),
    updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
  },
  (table) => [
    uniqueIndex("titleEpisodeStats_userId_titleId").on(table.userId, table.titleId),
  ],
);

export const appSettings = pgTable("appSettings", {
  key: text("key").primaryKey(),
  value: text("value"),
});

// 30.09, Sid — a settings-sync channel Moonfin can use directly, bypassing
// Moonbase entirely. Found live: Moonbase only syncs settings it natively
// recognizes ("paramètres pris en charge par le plugin") and silently
// drops anything custom (Moonfin's own IPTV provider list, pinned
// libraries) - confirmed by hand, pushed to Global from her phone, pulled
// on TV, nothing arrived. One JSON blob per linked Emby user account (not
// per device) - Moonfin owns the shape entirely, Sofa just stores and
// hands back whatever it's given.
export const moonfinSyncSettings = pgTable("moonfinSyncSettings", {
  embyUserId: text("embyUserId").primaryKey(),
  data: text("data").notNull(),
  updatedAt: timestamp("updatedAt", { mode: "date" }).notNull(),
});
