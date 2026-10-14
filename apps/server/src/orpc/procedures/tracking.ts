import { ORPCError } from "@orpc/server";

import { AppErrorCode } from "@sofa/api/errors";
import type { WatchScopeType } from "@sofa/api/schemas";
import { getWatchCount, getWatchHistory } from "@sofa/core/discovery";
import { getOrFetchTitleByTmdbId } from "@sofa/core/metadata";
import {
  getDisplayStatusesByTitleIds,
  getUserTitleInfo,
  logEpisodeWatch,
  setTitleStatus,
  unwatchLastEpisode,
  watchNextEpisode,
  logEpisodeWatchBatch,
  logMovieWatch,
  markAllEpisodesWatched,
  quickAddTitle,
  rateTitleStars,
  removeTitleStatus,
  rewatchTitle,
  unwatchEpisode,
  unwatchMovie,
  unwatchSeason,
  unwatchSeries,
  watchSeason,
} from "@sofa/core/tracking";
import { createLogger } from "@sofa/logger";

import { os } from "../context";
import { authed } from "../middleware";

const log = createLogger("tracking");

const watchHistoryTypeMap = { movie: "movies", episode: "episodes" } as const;

// ─── Watch handlers by scope ──────────────────────────────────

async function handleWatch(userId: string, scope: WatchScopeType, ids: string[]) {
  switch (scope) {
    case "movie":
      for (const id of ids) await logMovieWatch(userId, id);
      break;
    case "episode":
      if (ids.length === 1) {
        await logEpisodeWatch(userId, ids[0]);
      } else {
        await logEpisodeWatchBatch(userId, ids);
      }
      break;
    case "season":
      for (const id of ids) await watchSeason(userId, id);
      break;
    case "series":
      for (const id of ids) await markAllEpisodesWatched(userId, id);
      break;
  }
}

async function handleUnwatch(userId: string, scope: WatchScopeType, ids: string[]) {
  switch (scope) {
    case "movie":
      for (const id of ids) await unwatchMovie(userId, id);
      break;
    case "episode":
      for (const id of ids) await unwatchEpisode(userId, id);
      break;
    case "season":
      for (const id of ids) await unwatchSeason(userId, id);
      break;
    case "series":
      for (const id of ids) await unwatchSeries(userId, id);
      break;
  }
}

// ─── Procedures ───────────────────────────────────────────────

export const watch = os.tracking.watch.use(authed).handler(async ({ input, context }) => {
  await handleWatch(context.user.id, input.scope, input.ids);
});

export const unwatch = os.tracking.unwatch.use(authed).handler(async ({ input, context }) => {
  await handleUnwatch(context.user.id, input.scope, input.ids);
});

export const updateStatus = os.tracking.updateStatus
  .use(authed)
  .handler(async ({ input, context }) => {
    if (input.status === null) {
      await removeTitleStatus(context.user.id, input.id);
      return;
    }

    // Auto-import from TMDB if the title is a shell (absorbs quickAdd logic)
    const result = await quickAddTitle(context.user.id, input.id);
    if (!result) {
      throw new ORPCError("NOT_FOUND", {
        message: "Title not found",
        data: { code: AppErrorCode.TITLE_NOT_FOUND },
      });
    }
    if (!result.alreadyAdded) {
      getOrFetchTitleByTmdbId(result.tmdbId, result.type as "movie" | "tv").catch((err) => {
        log.warn(`Failed to import ${result.type} TMDB ${result.tmdbId}:`, err);
      });
    }

    // Explicitly (re)apply the requested status, even if the title already existed
    // (quickAddTitle only sets an initial status for brand-new library entries).
    if (input.status === "dropped" || (input.status === "watchlist" && result.alreadyAdded)) {
      await setTitleStatus(context.user.id, input.id, input.status);
    }
  });

export const watchNext = os.tracking.watchNext.use(authed).handler(({ input, context }) => {
  return watchNextEpisode(context.user.id, input.id);
});

export const unwatchLast = os.tracking.unwatchLast.use(authed).handler(({ input, context }) => {
  return unwatchLastEpisode(context.user.id, input.id);
});

export const rewatch = os.tracking.rewatch.use(authed).handler(async ({ input, context }) => {
  await rewatchTitle(context.user.id, input.id);
});

export const rate = os.tracking.rate.use(authed).handler(async ({ input, context }) => {
  await rateTitleStars(context.user.id, input.id, input.stars);
});

export const userInfo = os.tracking.userInfo.use(authed).handler(async ({ input, context }) => {
  const info = await getUserTitleInfo(context.user.id, input.id);
  if (!info.status) return { ...info, status: null };

  const displayStatuses = await getDisplayStatusesByTitleIds(context.user.id, [input.id]);
  return { ...info, status: displayStatuses[input.id] ?? null };
});

export const stats = os.tracking.stats.use(authed).handler(async ({ input, context }) => {
  const coreType = watchHistoryTypeMap[input.type];
  const count = await getWatchCount(context.user.id, coreType, input.period);
  const history = await getWatchHistory(context.user.id, coreType, input.period);
  return { count, history };
});
