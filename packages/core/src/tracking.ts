import {
  getEpisodesBySeasonIds,
  getSeasonsByTitleIds,
  getTitlesByIds,
} from "@sofa/db/queries/discovery";
import { getTitleById } from "@sofa/db/queries/title";
import {
  batchInsertEpisodeWatchesTransaction,
  batchInsertMissingEpisodeWatches,
  countDistinctEpisodeWatches,
  deleteAllEpisodeWatchesForTitle,
  deleteEpisodeWatch,
  deleteEpisodeWatches,
  deleteMovieWatches,
  deleteRating,
  deleteTitleStatus,
  getAllEpisodeIdsForTitle,
  getEpisodeProgressByTitleIds as getEpisodeProgressByTitleIdsQuery,
  getEpisodeTitleId,
  getEpisodeTitleIds,
  getExistingEpisodeWatchIds,
  getSeasonById,
  getSeasonEpisodeIds,
  getTitleCycle,
  getTitleCyclesByTitleIds,
  getTitleStatus,
  getTvRewatchCountsByTitleIds as getTvRewatchCountsByTitleIdsQuery,
  getUserStatusesByTitleIds as getUserStatusesByTitleIdsQuery,
  getUserTitleInfo as getUserTitleInfoQuery,
  incrementTitleCycle,
  insertEpisodeWatch,
  insertMovieWatch,
  resetTitleCycle,
  upsertRating,
  upsertTitleStatus,
} from "@sofa/db/queries/tracking";

import { WATCH_MIRROR_SOURCE_USER_ID, WATCH_MIRROR_TARGET_USER_ID } from "@sofa/config";
import type { DisplayStatus } from "./display-status";
import { getDisplayStatus } from "./display-status";

// 25.08, Sid — household context: Sid ("Pepette") and her husband ("XA")
// each have their own Emby library folders, plus a shared "CARBA" pair they
// watch together. Watch status is tracked per-user, so a CARBA title
// watched under Pepette showed unwatched for XA even though they watched it
// together — deferred 24.08, picked back up tonight. Explicitly one-way
// only (source -> target), and only for CARBA-prefixed libraries — never
// XA's or Pepette's own separate folders, never the reverse direction, and
// never any other household member (Eric/Mamisa/Mary/Poulet's own webhooks
// are unaffected, since they never match WATCH_MIRROR_SOURCE_USER_ID).
async function mirrorCarbaWatch(
  userId: string,
  embyLibraryName: string | null | undefined,
  logFn: () => Promise<void>,
): Promise<void> {
  if (
    !WATCH_MIRROR_SOURCE_USER_ID ||
    !WATCH_MIRROR_TARGET_USER_ID ||
    userId !== WATCH_MIRROR_SOURCE_USER_ID ||
    !embyLibraryName?.startsWith("CARBA")
  ) {
    return;
  }
  await logFn();
}

export async function setTitleStatus(
  userId: string,
  titleId: string,
  status: "watchlist" | "in_progress" | "completed" | "dropped",
  _source: "manual" | "import" | "jellyfin" | "emby" = "manual",
  addedAt?: Date,
): Promise<void> {
  await upsertTitleStatus(userId, titleId, status, addedAt);
}

export async function removeTitleStatus(userId: string, titleId: string): Promise<void> {
  await deleteTitleStatus(userId, titleId);
}

export async function logMovieWatch(
  userId: string,
  titleId: string,
  source: "manual" | "import" | "jellyfin" | "emby" = "manual",
  watchedAt?: Date,
): Promise<void> {
  const now = watchedAt ?? new Date();
  await insertMovieWatch(userId, titleId, now, source);

  // Auto-set status to completed
  const [existing] = await getTitleStatus(userId, titleId);

  if (!existing) {
    await setTitleStatus(userId, titleId, "completed", source);
  } else if (existing.status !== "completed") {
    await setTitleStatus(userId, titleId, "completed", source);
  }

  const [title] = await getTitleById(titleId);
  await mirrorCarbaWatch(userId, title?.embyLibraryName, () =>
    logMovieWatch(WATCH_MIRROR_TARGET_USER_ID!, titleId, source, now),
  );
}

export async function logEpisodeWatch(
  userId: string,
  episodeId: string,
  source: "manual" | "import" | "jellyfin" | "emby" = "manual",
  watchedAt?: Date,
): Promise<void> {
  const now = watchedAt ?? new Date();

  // Find the title for this episode
  const titleId = await getEpisodeTitleId(episodeId);
  const cycle = titleId ? await getTitleCycle(userId, titleId) : 1;
  await insertEpisodeWatch(userId, episodeId, now, source, cycle);

  if (!titleId) return;

  // Auto-set status to in_progress if not set or still on watchlist
  const [existing] = await getTitleStatus(userId, titleId);

  if (!existing || existing.status === "watchlist") {
    await setTitleStatus(userId, titleId, "in_progress", source);
  }

  const [title] = await getTitleById(titleId);
  await mirrorCarbaWatch(userId, title?.embyLibraryName, () =>
    logEpisodeWatch(WATCH_MIRROR_TARGET_USER_ID!, episodeId, source, now),
  );
}

export async function logEpisodeWatchBatch(
  userId: string,
  episodeIds: string[],
  source: "manual" | "import" | "jellyfin" | "emby" = "manual",
  watchedAt?: Date,
): Promise<void> {
  if (episodeIds.length === 0) return;

  await batchInsertEpisodeWatchesTransaction(userId, episodeIds, source, watchedAt);

  // Auto-set title status to in_progress for affected titles
  const episodeTitleMap = await getEpisodeTitleIds(episodeIds);
  const titleIds = new Set(episodeTitleMap.values());
  for (const titleId of titleIds) {
    const [existing] = await getTitleStatus(userId, titleId);
    if (!existing || existing.status === "watchlist") {
      await setTitleStatus(userId, titleId, "in_progress", source);
    }
  }
}

export async function markAllEpisodesWatched(
  userId: string,
  titleId: string,
  source: "manual" | "import" | "jellyfin" | "emby" = "manual",
): Promise<void> {
  const [title] = await getTitleById(titleId);
  if (!title || title.type !== "tv") return;

  const now = new Date();
  const cycle = await getTitleCycle(userId, titleId);
  const epIds = await getAllEpisodeIdsForTitle(titleId);
  const existingWatches = await getExistingEpisodeWatchIds(userId, epIds, cycle);

  await batchInsertMissingEpisodeWatches(userId, epIds, existingWatches, source, now, cycle);

  // TV never stores 'completed' — set in_progress and let display status derive the rest
  await setTitleStatus(userId, titleId, "in_progress", source);
}

export async function unwatchEpisode(userId: string, episodeId: string): Promise<void> {
  const titleId = await getEpisodeTitleId(episodeId);
  const cycle = titleId ? await getTitleCycle(userId, titleId) : 1;
  await deleteEpisodeWatch(userId, episodeId, cycle);

  if (!titleId) return;

  const [existing] = await getTitleStatus(userId, titleId);
  if (!existing || existing.status !== "in_progress") return;

  // If no episodes remain watched in the current cycle, downgrade to watchlist
  const epIds = await getAllEpisodeIdsForTitle(titleId);
  const watchCount = await countDistinctEpisodeWatches(userId, epIds, cycle);
  if (watchCount === 0) {
    await setTitleStatus(userId, titleId, "watchlist");
  }
}

export async function unwatchSeason(userId: string, seasonId: string): Promise<void> {
  const [season] = await getSeasonById(seasonId);
  if (!season) return;
  const cycle = await getTitleCycle(userId, season.titleId);

  const epIds = await getSeasonEpisodeIds(seasonId);
  if (epIds.length > 0) {
    await deleteEpisodeWatches(userId, epIds, cycle);
  }

  const [existing] = await getTitleStatus(userId, season.titleId);
  if (!existing || existing.status !== "in_progress") return;

  // If no episodes remain watched in the current cycle, downgrade to watchlist
  const allEpIds = await getAllEpisodeIdsForTitle(season.titleId);
  const watchCount = await countDistinctEpisodeWatches(userId, allEpIds, cycle);
  if (watchCount === 0) {
    await setTitleStatus(userId, season.titleId, "watchlist");
  }
}

export async function unwatchMovie(userId: string, titleId: string): Promise<void> {
  await deleteMovieWatches(userId, titleId);

  const [existing] = await getTitleStatus(userId, titleId);
  if (existing && existing.status !== "watchlist") {
    await setTitleStatus(userId, titleId, "watchlist");
  }
}

export async function unwatchSeries(userId: string, titleId: string): Promise<void> {
  // Full reset: wipes every rewatch cycle's history, so the cycle counter
  // resets to 1 too — otherwise a later rewatch badge would count cycles
  // that no longer have any watch history behind them.
  await deleteAllEpisodeWatchesForTitle(userId, titleId);
  await resetTitleCycle(userId, titleId);

  const [existing] = await getTitleStatus(userId, titleId);
  if (existing && existing.status !== "watchlist") {
    await setTitleStatus(userId, titleId, "watchlist");
  }
}

/** Starts a new watch-through of a title from scratch. TV: bumps the
 * rewatch cycle so the show reappears in "To Watch" at 0/N without erasing
 * previous cycles' watch history. Movies: rewatching is just logging
 * another watch (userMovieWatches already supports multiple rows). */
export async function rewatchTitle(userId: string, titleId: string): Promise<void> {
  const [title] = await getTitleById(titleId);
  if (!title) return;
  if (title.type === "movie") {
    await logMovieWatch(userId, titleId);
    return;
  }
  await incrementTitleCycle(userId, titleId);
}

export function getTvRewatchCountsByTitleIds(
  userId: string,
  titleIds: string[],
): Promise<Map<string, number>> {
  return getTvRewatchCountsByTitleIdsQuery(userId, titleIds);
}

export async function rateTitleStars(
  userId: string,
  titleId: string,
  ratingStars: number,
  ratedAt?: Date,
): Promise<void> {
  const now = ratedAt ?? new Date();
  if (ratingStars === 0) {
    await deleteRating(userId, titleId);
    return;
  }
  await upsertRating(userId, titleId, ratingStars, now);
}

export async function getUserStatusesByTitleIds(
  userId: string,
  titleIds: string[],
): Promise<Record<string, "watchlist" | "in_progress" | "completed">> {
  if (titleIds.length === 0) return {};

  const rows = await getUserStatusesByTitleIdsQuery(userId, titleIds);

  const result: Record<string, "watchlist" | "in_progress" | "completed"> = {};
  for (const row of rows) {
    result[row.titleId] = row.status as "watchlist" | "in_progress" | "completed";
  }
  return result;
}

/**
 * Derive display statuses for a set of titles.
 * Resolves stored status + episode progress + TMDB show status into display status.
 */
export async function getDisplayStatusesByTitleIds(
  userId: string,
  titleIds: string[],
): Promise<Record<string, DisplayStatus>> {
  if (titleIds.length === 0) return {};

  const storedStatuses = await getUserStatusesByTitleIds(userId, titleIds);
  const statusEntries = Object.entries(storedStatuses);
  if (statusEntries.length === 0) return {};

  // Find TV titles with in_progress status that need episode progress resolution
  const tvInProgressIds = statusEntries
    .filter(([, status]) => status === "in_progress")
    .map(([id]) => id);

  // Fetch title data for type + TMDB status
  const trackedIds = statusEntries.map(([id]) => id);
  const titles = await getTitlesByIds(trackedIds);
  const titleMap = new Map(titles.map((t) => [t.id, t]));

  // Fetch episode progress for TV in_progress titles
  const episodeProgress =
    tvInProgressIds.length > 0 ? await getEpisodeProgressByTitleIds(userId, tvInProgressIds) : {};
  // 31.08, Sid rewatch badge fix — needed to tell "never rewatched, 0
  // watched" (in_watchlist territory) apart from "just hit Watch Again, 0
  // watched in the new cycle" (should still read as completed/rewatch
  // badge, see display-status.ts).
  const cycles =
    tvInProgressIds.length > 0
      ? await getTitleCyclesByTitleIds(userId, tvInProgressIds)
      : new Map<string, number>();

  const result: Record<string, DisplayStatus> = {};
  for (const [titleId, storedStatus] of statusEntries) {
    const title = titleMap.get(titleId);
    const titleType = (title?.type ?? "movie") as "movie" | "tv";
    const tmdbStatus = title?.status ?? null;
    const progress = episodeProgress[titleId] ?? null;
    const currentCycle = cycles.get(titleId) ?? 1;

    result[titleId] = getDisplayStatus(storedStatus, titleType, tmdbStatus, progress, currentCycle);
  }
  return result;
}

export async function getEpisodeProgressByTitleIds(
  userId: string,
  titleIds: string[],
): Promise<Record<string, { watched: number; total: number }>> {
  if (titleIds.length === 0) return {};

  const rows = await getEpisodeProgressByTitleIdsQuery(userId, titleIds);

  const result: Record<string, { watched: number; total: number }> = {};
  for (const row of rows) {
    // 26.08, Sid — series not yet started should still show "0/X" on the
    // card, not nothing. Only real gate is "has episode data at all"
    // (matches title-card.tsx's own episodeProgress.total > 0 check).
    if (row.totalEpisodes > 0) {
      result[row.titleId] = {
        watched: row.watchedEpisodes,
        total: row.totalEpisodes,
      };
    }
  }
  return result;
}

export async function getUserTitleInfo(userId: string, titleId: string) {
  return getUserTitleInfoQuery(userId, titleId);
}

export async function quickAddTitle(
  userId: string,
  titleId: string,
): Promise<{ id: string; tmdbId: number; type: string; alreadyAdded: boolean } | null> {
  const [title] = await getTitleById(titleId);
  if (!title) return null;

  const [existing] = await getTitleStatus(userId, titleId);

  if (!existing) {
    await setTitleStatus(userId, titleId, "watchlist");
  }

  return { id: title.id, tmdbId: title.tmdbId, type: title.type, alreadyAdded: !!existing };
}

async function getOrderedEpisodesForTitle(titleId: string) {
  const seasonsForTitle = await getSeasonsByTitleIds([titleId]);
  const seasonIds = seasonsForTitle.map((s) => s.id);
  const allEpisodes = await getEpisodesBySeasonIds(seasonIds);
  const seasonMap = new Map(seasonsForTitle.map((s) => [s.id, s]));
  return allEpisodes
    .map((ep) => ({ ep, season: seasonMap.get(ep.seasonId) }))
    .filter((x): x is { ep: typeof x.ep; season: NonNullable<typeof x.season> } => !!x.season)
    .sort((a, b) => {
      if (a.season.seasonNumber !== b.season.seasonNumber) {
        return a.season.seasonNumber - b.season.seasonNumber;
      }
      return a.ep.episodeNumber - b.ep.episodeNumber;
    });
}

export async function getNextUnwatchedEpisode(userId: string, titleId: string) {
  const info = await getUserTitleInfoQuery(userId, titleId);
  const watchedSet = new Set(info.episodeWatches);
  const today = new Date().toISOString().slice(0, 10);
  for (const { ep, season } of await getOrderedEpisodesForTitle(titleId)) {
    if (watchedSet.has(ep.id)) continue;
    if (ep.airDate && ep.airDate > today) continue;
    return { id: ep.id, seasonNumber: season.seasonNumber, episodeNumber: ep.episodeNumber };
  }
  return null;
}

export async function getLastWatchedEpisode(userId: string, titleId: string) {
  const info = await getUserTitleInfoQuery(userId, titleId);
  const watchedSet = new Set(info.episodeWatches);
  if (watchedSet.size === 0) return null;
  const ordered = (await getOrderedEpisodesForTitle(titleId)).filter((x) =>
    watchedSet.has(x.ep.id),
  );
  const last = ordered[ordered.length - 1];
  return last
    ? { id: last.ep.id, seasonNumber: last.season.seasonNumber, episodeNumber: last.ep.episodeNumber }
    : null;
}

export async function watchNextEpisode(userId: string, titleId: string) {
  const next = await getNextUnwatchedEpisode(userId, titleId);
  if (!next) return null;
  await logEpisodeWatch(userId, next.id);
  return next;
}

export async function unwatchLastEpisode(userId: string, titleId: string) {
  const last = await getLastWatchedEpisode(userId, titleId);
  if (!last) return null;
  await unwatchEpisode(userId, last.id);
  return last;
}

export async function watchSeason(userId: string, seasonId: string): Promise<void> {
  await logEpisodeWatchBatch(userId, await getSeasonEpisodeIds(seasonId));
}
