CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appSettings" (
	"key" text PRIMARY KEY,
	"value" text
);
--> statement-breakpoint
CREATE TABLE "cronRuns" (
	"id" text PRIMARY KEY,
	"jobName" text NOT NULL,
	"status" text NOT NULL,
	"startedAt" timestamp NOT NULL,
	"finishedAt" timestamp,
	"durationMs" integer,
	"errorMessage" text
);
--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" text PRIMARY KEY,
	"seasonId" text NOT NULL,
	"episodeNumber" integer NOT NULL,
	"name" text,
	"overview" text,
	"nameFr" text,
	"overviewFr" text,
	"stillPath" text,
	"stillThumbHash" text,
	"airDate" text,
	"runtimeMinutes" integer,
	"embyItemId" text,
	"notifiedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "genres" (
	"id" integer PRIMARY KEY,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "importJobs" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"source" text NOT NULL,
	"status" text NOT NULL,
	"payload" text NOT NULL,
	"importWatches" boolean NOT NULL,
	"importWatchlist" boolean NOT NULL,
	"importRatings" boolean NOT NULL,
	"totalItems" integer DEFAULT 0 NOT NULL,
	"processedItems" integer DEFAULT 0 NOT NULL,
	"importedCount" integer DEFAULT 0 NOT NULL,
	"skippedCount" integer DEFAULT 0 NOT NULL,
	"failedCount" integer DEFAULT 0 NOT NULL,
	"currentMessage" text,
	"errors" text,
	"warnings" text,
	"createdAt" timestamp NOT NULL,
	"startedAt" timestamp,
	"finishedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "integrationEvents" (
	"id" text PRIMARY KEY,
	"integrationId" text NOT NULL,
	"eventType" text,
	"mediaType" text,
	"mediaTitle" text,
	"status" text NOT NULL,
	"errorMessage" text,
	"receivedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"token" text NOT NULL UNIQUE,
	"embyUsername" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp NOT NULL,
	"lastEventAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "moonfinSyncSettings" (
	"embyUserId" text PRIMARY KEY,
	"data" text NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personFilmography" (
	"id" text PRIMARY KEY,
	"personId" text NOT NULL,
	"titleId" text NOT NULL,
	"character" text,
	"department" text DEFAULT 'Acting' NOT NULL,
	"job" text,
	"displayOrder" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persons" (
	"id" text PRIMARY KEY,
	"tmdbId" integer NOT NULL,
	"name" text NOT NULL,
	"biography" text,
	"birthday" text,
	"deathday" text,
	"placeOfBirth" text,
	"profilePath" text,
	"profileThumbHash" text,
	"knownForDepartment" text,
	"popularity" real,
	"imdbId" text,
	"lastFetchedAt" timestamp,
	"filmographyLastFetchedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "platformTmdbIds" (
	"platformId" text NOT NULL,
	"tmdbProviderId" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platforms" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"logoPath" text,
	"urlTemplate" text,
	"isSubscription" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pushSubscriptions" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"endpoint" text NOT NULL UNIQUE,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"userAgent" text,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" text PRIMARY KEY,
	"titleId" text NOT NULL,
	"seasonNumber" integer NOT NULL,
	"name" text,
	"overview" text,
	"posterPath" text,
	"posterThumbHash" text,
	"airDate" text,
	"lastFetchedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"token" text NOT NULL UNIQUE,
	"expiresAt" timestamp NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"impersonatedBy" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "titleAvailability" (
	"titleId" text NOT NULL,
	"platformId" text NOT NULL,
	"offerType" text NOT NULL,
	"region" text DEFAULT 'US' NOT NULL,
	"lastFetchedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "titleCast" (
	"id" text PRIMARY KEY,
	"titleId" text NOT NULL,
	"personId" text NOT NULL,
	"character" text,
	"department" text DEFAULT 'Acting' NOT NULL,
	"job" text,
	"displayOrder" integer DEFAULT 0 NOT NULL,
	"episodeCount" integer,
	"lastFetchedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "titleEpisodeStats" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"titleId" text NOT NULL,
	"airedCount" integer NOT NULL,
	"watchedCount" integer NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "titleGenres" (
	"titleId" text NOT NULL,
	"genreId" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "titleRecommendations" (
	"titleId" text NOT NULL,
	"recommendedTitleId" text NOT NULL,
	"source" text NOT NULL,
	"rank" integer NOT NULL,
	"lastFetchedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "titles" (
	"id" text PRIMARY KEY,
	"tmdbId" integer NOT NULL,
	"tvdbId" integer,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"originalTitle" text,
	"overview" text,
	"overviewFr" text,
	"releaseDate" text,
	"firstAirDate" text,
	"posterPath" text,
	"posterThumbHash" text,
	"backdropPath" text,
	"backdropThumbHash" text,
	"popularity" real,
	"voteAverage" real,
	"voteCount" integer,
	"status" text,
	"contentRating" text,
	"imdbId" text,
	"originalLanguage" text,
	"runtimeMinutes" integer,
	"colorPalette" text,
	"trailerVideoKey" text,
	"lastFetchedAt" timestamp,
	"tvdbTranslatedAt" timestamp,
	"inEmbyLibrary" boolean DEFAULT false NOT NULL,
	"embyItemId" text,
	"embyLibraryName" text,
	"requestedAt" timestamp,
	"requestedByUserId" text
);
--> statement-breakpoint
CREATE TABLE "unresolvedSeriesRequests" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"titleId" text NOT NULL,
	"requestedByName" text NOT NULL,
	"reason" text NOT NULL,
	"rootFolderPath" text,
	"qualityProfileId" integer,
	"seasonNumbers" text,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'user',
	"banned" boolean DEFAULT false,
	"banReason" text,
	"banExpires" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userDismissedPlaybackDevices" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"embyDeviceId" text NOT NULL,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userEmbyLibraries" (
	"userId" text NOT NULL,
	"embyLibraryName" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userEpisodeWatches" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"episodeId" text NOT NULL,
	"watchedAt" timestamp NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userMovieWatches" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"titleId" text NOT NULL,
	"watchedAt" timestamp NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userPlatforms" (
	"userId" text NOT NULL,
	"platformId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userPlaybackDevices" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"embyDeviceId" text NOT NULL,
	"embyDeviceName" text NOT NULL,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userRatings" (
	"userId" text NOT NULL,
	"titleId" text NOT NULL,
	"ratingStars" integer NOT NULL,
	"ratedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userRequestDefaults" (
	"userId" text PRIMARY KEY,
	"radarrRootFolder" text,
	"radarrQualityProfileId" integer,
	"sonarrRootFolder" text,
	"sonarrQualityProfileId" integer,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "userTitleStatus" (
	"userId" text NOT NULL,
	"titleId" text NOT NULL,
	"status" text NOT NULL,
	"addedAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"currentCycle" integer DEFAULT 1 NOT NULL,
	"requestedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp,
	"updatedAt" timestamp
);
--> statement-breakpoint
CREATE INDEX "cronRuns_jobName_startedAt" ON "cronRuns" ("jobName","startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "episodes_seasonId_episodeNumber" ON "episodes" ("seasonId","episodeNumber");--> statement-breakpoint
CREATE INDEX "episodes_airDate" ON "episodes" ("airDate");--> statement-breakpoint
CREATE INDEX "episodes_embyItemId" ON "episodes" ("embyItemId") WHERE "embyItemId" is not null;--> statement-breakpoint
CREATE INDEX "importJobs_userId_createdAt" ON "importJobs" ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "importJobs_status" ON "importJobs" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "importJobs_active_user" ON "importJobs" ("userId") WHERE "status" in ('pending', 'running');--> statement-breakpoint
CREATE INDEX "integrationEvents_integrationId_receivedAt" ON "integrationEvents" ("integrationId","receivedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_userId_provider" ON "integrations" ("userId","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_token" ON "integrations" ("token");--> statement-breakpoint
CREATE INDEX "personFilmography_personId_displayOrder" ON "personFilmography" ("personId","displayOrder");--> statement-breakpoint
CREATE INDEX "personFilmography_titleId" ON "personFilmography" ("titleId");--> statement-breakpoint
CREATE UNIQUE INDEX "persons_tmdbId_unique" ON "persons" ("tmdbId");--> statement-breakpoint
CREATE INDEX "persons_name" ON "persons" ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "platformTmdbIds_tmdbProviderId_unique" ON "platformTmdbIds" ("tmdbProviderId");--> statement-breakpoint
CREATE INDEX "platformTmdbIds_platformId" ON "platformTmdbIds" ("platformId");--> statement-breakpoint
CREATE INDEX "pushSubscriptions_userId" ON "pushSubscriptions" ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_titleId_seasonNumber" ON "seasons" ("titleId","seasonNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "titleAvailability_unique" ON "titleAvailability" ("titleId","platformId","offerType","region");--> statement-breakpoint
CREATE INDEX "titleAvailability_titleId" ON "titleAvailability" ("titleId");--> statement-breakpoint
CREATE INDEX "titleAvailability_platformId" ON "titleAvailability" ("platformId");--> statement-breakpoint
CREATE UNIQUE INDEX "titleCast_unique" ON "titleCast" ("titleId","personId","department","character");--> statement-breakpoint
CREATE INDEX "titleCast_titleId_displayOrder" ON "titleCast" ("titleId","displayOrder");--> statement-breakpoint
CREATE INDEX "titleCast_personId" ON "titleCast" ("personId");--> statement-breakpoint
CREATE UNIQUE INDEX "titleEpisodeStats_userId_titleId" ON "titleEpisodeStats" ("userId","titleId");--> statement-breakpoint
CREATE UNIQUE INDEX "titleGenres_titleId_genreId" ON "titleGenres" ("titleId","genreId");--> statement-breakpoint
CREATE INDEX "titleGenres_genreId" ON "titleGenres" ("genreId");--> statement-breakpoint
CREATE UNIQUE INDEX "titleRecommendations_unique" ON "titleRecommendations" ("titleId","recommendedTitleId","source");--> statement-breakpoint
CREATE INDEX "titleRecommendations_titleId_rank" ON "titleRecommendations" ("titleId","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "titles_tmdbId_type_unique" ON "titles" ("tmdbId","type");--> statement-breakpoint
CREATE INDEX "titles_type_releaseDate" ON "titles" ("type","releaseDate");--> statement-breakpoint
CREATE INDEX "titles_type_firstAirDate" ON "titles" ("type","firstAirDate");--> statement-breakpoint
CREATE INDEX "titles_lastFetchedAt" ON "titles" ("lastFetchedAt");--> statement-breakpoint
CREATE INDEX "titles_type_status_lastFetchedAt" ON "titles" ("type","status","lastFetchedAt");--> statement-breakpoint
CREATE INDEX "titles_inEmbyLibrary" ON "titles" ("inEmbyLibrary");--> statement-breakpoint
CREATE INDEX "titles_tvdbId" ON "titles" ("tvdbId");--> statement-breakpoint
CREATE INDEX "titles_embyItemId" ON "titles" ("embyItemId") WHERE "embyItemId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "unresolvedSeriesRequests_userId_titleId" ON "unresolvedSeriesRequests" ("userId","titleId");--> statement-breakpoint
CREATE INDEX "unresolvedSeriesRequests_userId" ON "unresolvedSeriesRequests" ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "userDismissedPlaybackDevices_userId_embyDeviceId" ON "userDismissedPlaybackDevices" ("userId","embyDeviceId");--> statement-breakpoint
CREATE INDEX "userDismissedPlaybackDevices_userId" ON "userDismissedPlaybackDevices" ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "userEmbyLibraries_userId_embyLibraryName" ON "userEmbyLibraries" ("userId","embyLibraryName");--> statement-breakpoint
CREATE INDEX "userEmbyLibraries_embyLibraryName" ON "userEmbyLibraries" ("embyLibraryName");--> statement-breakpoint
CREATE INDEX "userEpisodeWatches_userId_watchedAt" ON "userEpisodeWatches" ("userId","watchedAt");--> statement-breakpoint
CREATE INDEX "userEpisodeWatches_episodeId" ON "userEpisodeWatches" ("episodeId");--> statement-breakpoint
CREATE INDEX "userEpisodeWatches_userId_episodeId" ON "userEpisodeWatches" ("userId","episodeId");--> statement-breakpoint
CREATE INDEX "userEpisodeWatches_userId_episodeId_cycle" ON "userEpisodeWatches" ("userId","episodeId","cycle");--> statement-breakpoint
CREATE INDEX "userMovieWatches_userId_watchedAt" ON "userMovieWatches" ("userId","watchedAt");--> statement-breakpoint
CREATE INDEX "userMovieWatches_titleId" ON "userMovieWatches" ("titleId");--> statement-breakpoint
CREATE INDEX "userMovieWatches_userId_titleId" ON "userMovieWatches" ("userId","titleId");--> statement-breakpoint
CREATE UNIQUE INDEX "userPlatforms_userId_platformId" ON "userPlatforms" ("userId","platformId");--> statement-breakpoint
CREATE INDEX "userPlatforms_userId" ON "userPlatforms" ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "userPlaybackDevices_userId_embyDeviceId" ON "userPlaybackDevices" ("userId","embyDeviceId");--> statement-breakpoint
CREATE INDEX "userPlaybackDevices_userId" ON "userPlaybackDevices" ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "userRatings_userId_titleId" ON "userRatings" ("userId","titleId");--> statement-breakpoint
CREATE UNIQUE INDEX "userTitleStatus_userId_titleId" ON "userTitleStatus" ("userId","titleId");--> statement-breakpoint
CREATE INDEX "userTitleStatus_userId_status" ON "userTitleStatus" ("userId","status");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_seasonId_seasons_id_fkey" FOREIGN KEY ("seasonId") REFERENCES "seasons"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "importJobs" ADD CONSTRAINT "importJobs_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integrationEvents" ADD CONSTRAINT "integrationEvents_integrationId_integrations_id_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "personFilmography" ADD CONSTRAINT "personFilmography_personId_persons_id_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "personFilmography" ADD CONSTRAINT "personFilmography_titleId_titles_id_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platformTmdbIds" ADD CONSTRAINT "platformTmdbIds_platformId_platforms_id_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pushSubscriptions" ADD CONSTRAINT "pushSubscriptions_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_titleId_titles_id_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "titleAvailability" ADD CONSTRAINT "titleAvailability_titleId_titles_id_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "titleAvailability" ADD CONSTRAINT "titleAvailability_platformId_platforms_id_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "titleCast" ADD CONSTRAINT "titleCast_titleId_titles_id_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "titleCast" ADD CONSTRAINT "titleCast_personId_persons_id_fkey" FOREIGN KEY ("personId") REFERENCES "persons"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "titleEpisodeStats" ADD CONSTRAINT "titleEpisodeStats_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "titleEpisodeStats" ADD CONSTRAINT "titleEpisodeStats_titleId_titles_id_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "titleGenres" ADD CONSTRAINT "titleGenres_titleId_titles_id_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "titleGenres" ADD CONSTRAINT "titleGenres_genreId_genres_id_fkey" FOREIGN KEY ("genreId") REFERENCES "genres"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "titleRecommendations" ADD CONSTRAINT "titleRecommendations_titleId_titles_id_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "titleRecommendations" ADD CONSTRAINT "titleRecommendations_recommendedTitleId_titles_id_fkey" FOREIGN KEY ("recommendedTitleId") REFERENCES "titles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "titles" ADD CONSTRAINT "titles_requestedByUserId_user_id_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "unresolvedSeriesRequests" ADD CONSTRAINT "unresolvedSeriesRequests_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "unresolvedSeriesRequests" ADD CONSTRAINT "unresolvedSeriesRequests_titleId_titles_id_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userDismissedPlaybackDevices" ADD CONSTRAINT "userDismissedPlaybackDevices_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userEmbyLibraries" ADD CONSTRAINT "userEmbyLibraries_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userEpisodeWatches" ADD CONSTRAINT "userEpisodeWatches_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userEpisodeWatches" ADD CONSTRAINT "userEpisodeWatches_episodeId_episodes_id_fkey" FOREIGN KEY ("episodeId") REFERENCES "episodes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userMovieWatches" ADD CONSTRAINT "userMovieWatches_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userMovieWatches" ADD CONSTRAINT "userMovieWatches_titleId_titles_id_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userPlatforms" ADD CONSTRAINT "userPlatforms_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userPlatforms" ADD CONSTRAINT "userPlatforms_platformId_platforms_id_fkey" FOREIGN KEY ("platformId") REFERENCES "platforms"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userPlaybackDevices" ADD CONSTRAINT "userPlaybackDevices_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userRatings" ADD CONSTRAINT "userRatings_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userRatings" ADD CONSTRAINT "userRatings_titleId_titles_id_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userRequestDefaults" ADD CONSTRAINT "userRequestDefaults_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userTitleStatus" ADD CONSTRAINT "userTitleStatus_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userTitleStatus" ADD CONSTRAINT "userTitleStatus_titleId_titles_id_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE;