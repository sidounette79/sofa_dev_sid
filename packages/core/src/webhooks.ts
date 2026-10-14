import { findEpisodeBySeasonAndNumber, findSeasonByTitleAndNumber } from "@sofa/db/queries/title";
import {
  getRecentEpisodeWatch,
  getRecentMovieWatch,
  insertIntegrationEventTransaction,
} from "@sofa/db/queries/webhooks";
import { createLogger } from "@sofa/logger";
import { getTvDetails } from "@sofa/tmdb/client";

import { resolveMovieTmdbId, resolveShowTmdbId } from "./imports/resolve";
import { getOrFetchTitleByTmdbId, refreshTvChildren } from "./metadata";
import { logEpisodeWatch, logMovieWatch } from "./tracking";

const log = createLogger("webhooks");

// ─── Types ──────────────────────────────────────────────────────────

export interface WebhookEvent {
  provider: "jellyfin" | "emby";
  mediaType: "movie" | "episode";
  title: string;
  tmdbId?: number;
  imdbId?: string;
  tvdbId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  showTitle?: string;
}

/** @internal */
export function toOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

// ─── Payload Parsers ────────────────────────────────────────────────

export function parseJellyfinPayload(body: Record<string, unknown>): WebhookEvent | null {
  const notifType = body.NotificationType as string | undefined;
  if (notifType !== "PlaybackStop") return null;
  if (body.PlayedToCompletion !== true) return null;

  const itemType = body.ItemType as string | undefined;
  const isMovie = itemType === "Movie";
  const isEpisode = itemType === "Episode";
  if (!isMovie && !isEpisode) return null;

  const tmdbId = toOptionalInt(body.Provider_tmdb);

  return {
    provider: "jellyfin",
    mediaType: isMovie ? "movie" : "episode",
    title: (body.Name ?? "") as string,
    tmdbId,
    imdbId: (body.Provider_imdb as string) || undefined,
    tvdbId: (body.Provider_tvdb as string) || undefined,
    seasonNumber: toOptionalInt(body.SeasonNumber),
    episodeNumber: toOptionalInt(body.EpisodeNumber),
    showTitle: (body.SeriesName ?? body.ShowName) as string | undefined,
  };
}

export function parseEmbyPayload(body: Record<string, unknown>): WebhookEvent | null {
  // Emby sends "playback.stop" or "PlaybackStop" depending on webhook plugin version.
  // A manual "mark as played" click fires a separate event (name contains
  // "MarkPlayed", not "Unplayed") that we treat as an equivalent completed
  // playback.stop.
  const rawEvent = body.Event as string | undefined;
  const isMarkPlayed =
    typeof rawEvent === "string" && /markplayed/i.test(rawEvent) && !/unplayed/i.test(rawEvent);
  const isPlaybackStop = rawEvent === "playback.stop" || rawEvent === "PlaybackStop";
  if (!isPlaybackStop && !isMarkPlayed) return null;

  // Some Emby webhook plugin versions nest PlayedToCompletion under
  // PlaybackInfo instead of sending it at the payload root.
  const playbackInfo = body.PlaybackInfo as Record<string, unknown> | undefined;
  const playedToCompletion =
    body.PlayedToCompletion === true ||
    playbackInfo?.PlayedToCompletion === true ||
    isMarkPlayed;
  if (!playedToCompletion) return null;

  const item = body.Item as Record<string, unknown> | undefined;
  if (!item) return null;

  const itemType = item.Type as string | undefined;
  const isMovie = itemType === "Movie";
  const isEpisode = itemType === "Episode";
  if (!isMovie && !isEpisode) return null;

  const providerIds = (item.ProviderIds ?? {}) as Record<string, string>;
  const tmdbId = toOptionalInt(providerIds.Tmdb);

  return {
    provider: "emby",
    mediaType: isMovie ? "movie" : "episode",
    title: (item.Name ?? "") as string,
    tmdbId,
    imdbId: providerIds.Imdb || undefined,
    tvdbId: providerIds.Tvdb || undefined,
    seasonNumber: toOptionalInt(item.ParentIndexNumber),
    episodeNumber: toOptionalInt(item.IndexNumber),
    showTitle: (item.SeriesName ?? item.ShowName) as string | undefined,
  };
}

// ─── Title Resolution ───────────────────────────────────────────────

async function resolveEpisode(event: WebhookEvent): Promise<{
  showTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
} | null> {
  const { seasonNumber, episodeNumber } = event;
  if (seasonNumber == null || episodeNumber == null) return null;

  const showTmdbId = await resolveShowTmdbId({
    tmdbId: event.tmdbId,
    imdbId: event.imdbId,
    tvdbId: event.tvdbId,
    title: event.showTitle,
  });

  if (!showTmdbId) return null;
  return { showTmdbId, seasonNumber, episodeNumber };
}

// ─── Deduplication ──────────────────────────────────────────────────

async function isDuplicateMovieWatch(userId: string, titleId: string): Promise<boolean> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const [recent] = await getRecentMovieWatch(userId, titleId, fiveMinutesAgo);
  return !!recent;
}

async function isDuplicateEpisodeWatch(userId: string, episodeId: string): Promise<boolean> {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const [recent] = await getRecentEpisodeWatch(userId, episodeId, fiveMinutesAgo);
  return !!recent;
}

// ─── Event Logging ──────────────────────────────────────────────────

async function logEvent(
  connectionId: string,
  event: WebhookEvent | null,
  status: "success" | "ignored" | "error",
  errorMessage?: string,
): Promise<void> {
  await insertIntegrationEventTransaction(
    {
      integrationId: connectionId,
      eventType: event?.provider === "emby" ? "playback.stop" : "PlaybackStop",
      mediaType: event?.mediaType ?? null,
      mediaTitle: event?.title ?? null,
      status,
      errorMessage: errorMessage ?? null,
      receivedAt: new Date(),
    },
    connectionId,
  );
}

// ─── Main Processing ────────────────────────────────────────────────

export async function processWebhook(
  connectionId: string,
  userId: string,
  provider: "jellyfin" | "emby",
  event: WebhookEvent,
): Promise<{ status: "success" | "ignored" | "error"; message: string }> {
  log.info(`Received ${provider} webhook: ${event.mediaType} "${event.title}"`);
  try {
    if (event.mediaType === "movie") {
      const hasExternalId = event.tmdbId || event.imdbId || event.tvdbId;
      const tmdbId = await resolveMovieTmdbId({
        tmdbId: event.tmdbId,
        imdbId: event.imdbId,
        tvdbId: event.tvdbId,
        // Only use title fallback when at least one external ID is present;
        // title-only resolution without year is too unreliable for webhooks
        title: hasExternalId ? event.title : undefined,
      });
      if (!tmdbId) {
        log.warn(`Could not resolve TMDB ID for movie "${event.title}" from ${provider}`);
        await logEvent(connectionId, event, "error", "Could not resolve TMDB ID for movie");
        return { status: "error", message: "Could not resolve TMDB ID" };
      }

      const title = await getOrFetchTitleByTmdbId(tmdbId, "movie");
      if (!title) {
        await logEvent(connectionId, event, "error", "Failed to import movie");
        return { status: "error", message: "Failed to import movie" };
      }

      if (await isDuplicateMovieWatch(userId, title.id)) {
        log.debug(`Duplicate movie watch ignored: "${event.title}"`);
        await logEvent(connectionId, event, "ignored", "Duplicate watch within 5 minutes");
        return { status: "ignored", message: "Duplicate watch" };
      }

      await logMovieWatch(userId, title.id, provider);
      log.info(`Logged movie watch: "${event.title}" (TMDB ${tmdbId})`);
      await logEvent(connectionId, event, "success");
      return { status: "success", message: `Logged watch for ${event.title}` };
    }

    if (event.mediaType === "episode") {
      const resolved = await resolveEpisode(event);
      if (!resolved) {
        log.warn(`Could not resolve episode "${event.title}" from ${provider}`);
        await logEvent(connectionId, event, "error", "Could not resolve episode");
        return { status: "error", message: "Could not resolve episode" };
      }

      // 21.08: instrumenting — investigating a freeze that correlates with
      // active Emby playback (this handler runs per watch webhook). Suspect:
      // these two steps make real TMDB network calls (getTvDetails,
      // refreshTvChildren's per-season fetches), and several incidents
      // tonight showed the whole server blocked for ~100-102s — suspiciously
      // close to a plausible multi-season-batch pileup of TMDB's own 30s
      // per-request timeout when its API is slow/unresponsive.
      let t0 = performance.now();
      const title = await getOrFetchTitleByTmdbId(resolved.showTmdbId, "tv");
      let ms = Math.round(performance.now() - t0);
      if (ms > 1000) log.warn(`Slow getOrFetchTitleByTmdbId for TMDB ${resolved.showTmdbId}: ${ms}ms`);
      if (!title) {
        await logEvent(connectionId, event, "error", "Failed to import TV show");
        return { status: "error", message: "Failed to import TV show" };
      }

      // Find the episode in our DB
      let [season] = await findSeasonByTitleAndNumber(title.id, resolved.seasonNumber);

      if (!season) {
        // Season might be newly released — try refreshing from TMDB
        try {
          t0 = performance.now();
          const show = await getTvDetails(resolved.showTmdbId);
          await refreshTvChildren(title.id, resolved.showTmdbId, show.number_of_seasons);
          ms = Math.round(performance.now() - t0);
          if (ms > 1000) {
            log.warn(
              `Slow season refresh for TMDB ${resolved.showTmdbId} (${show.number_of_seasons} seasons): ${ms}ms`,
            );
          }
          [season] = await findSeasonByTitleAndNumber(title.id, resolved.seasonNumber);
        } catch (err) {
          log.warn(`Failed to refresh seasons for TMDB ${resolved.showTmdbId}:`, err);
        }
      }

      if (!season) {
        await logEvent(connectionId, event, "error", `Season ${resolved.seasonNumber} not found`);
        return {
          status: "error",
          message: `Season ${resolved.seasonNumber} not found`,
        };
      }

      const [episode] = await findEpisodeBySeasonAndNumber(season.id, resolved.episodeNumber);

      if (!episode) {
        await logEvent(
          connectionId,
          event,
          "error",
          `S${resolved.seasonNumber}E${resolved.episodeNumber} not found`,
        );
        return {
          status: "error",
          message: `S${resolved.seasonNumber}E${resolved.episodeNumber} not found`,
        };
      }

      if (await isDuplicateEpisodeWatch(userId, episode.id)) {
        log.debug(`Duplicate episode watch ignored: "${event.title}"`);
        await logEvent(connectionId, event, "ignored", "Duplicate watch within 5 minutes");
        return { status: "ignored", message: "Duplicate watch" };
      }

      await logEpisodeWatch(userId, episode.id, provider);
      log.info(
        `Logged episode watch: "${event.title}" S${resolved.seasonNumber}E${resolved.episodeNumber}`,
      );
      await logEvent(connectionId, event, "success");
      return { status: "success", message: `Logged watch for ${event.title}` };
    }

    await logEvent(connectionId, event, "ignored", `Unsupported media type: ${event.mediaType}`);
    return { status: "ignored", message: "Unsupported media type" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    try {
      await logEvent(connectionId, event, "error", message);
    } catch {
      // best-effort
    }
    return { status: "error", message };
  }
}
