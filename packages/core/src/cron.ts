import {
  getCastEntryForTitle,
  getLibraryTitleIds as queryGetLibraryTitleIds,
  getReturningTvShows,
  getStaleTitles,
  getStaleNonLibraryTitles,
  getTitleByIdForCron,
  getTitleIdsNeedingImageBackfill,
  getTitleIdsWithStaleSeasons,
  getTitlesWithFreshRecommendations,
  getTitlesWithStaleOffers,
  getTitlesWithStaleOffersFetchedBefore,
  insertCronRunReturning,
  updateCronRunError,
  updateCronRunSuccess,
} from "@sofa/db/queries/cron";
import { reopenFinishedTvWithUnwatchedEpisodes } from "@sofa/db/queries/tracking";
import { createLogger } from "@sofa/logger";

export function startCronRun(jobName: string) {
  return insertCronRunReturning(jobName);
}

export function completeCronRun(runId: string, durationMs: number): Promise<void> {
  return updateCronRunSuccess(runId, durationMs);
}

export function failCronRun(runId: string, durationMs: number, error: unknown): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return updateCronRunError(runId, durationMs, errorMessage);
}

export function getLibraryTitleIds(): Promise<string[]> {
  return queryGetLibraryTitleIds();
}

export function getThumbhashBackfillTitleIds(): Promise<string[]> {
  return getTitleIdsNeedingImageBackfill();
}

export function getStaleLibraryTitles(libraryIds: string[], staleDate: Date) {
  return getStaleTitles(libraryIds, staleDate);
}

export function getStaleNonLibraryTitlesForRefresh(staleDate: Date, limit: number) {
  return getStaleNonLibraryTitles(staleDate, limit);
}

export async function getStaleAvailabilityTitles(libraryIds: string[], staleDate: Date) {
  const [withOffers, withStaleOffers] = await Promise.all([
    getTitlesWithStaleOffers(libraryIds),
    getTitlesWithStaleOffersFetchedBefore(libraryIds, staleDate),
  ]);
  return { withOffers, withStaleOffers };
}

export {
  getCastEntryForTitle,
  getReturningTvShows,
  getTitleByIdForCron,
  getTitleIdsWithStaleSeasons,
  getTitlesWithFreshRecommendations,
};

const logReopen = createLogger("reopenFinishedTv");

/**
 * 26.11, Sid : « les anneaux de pouvoir que je suis en train de regarder
 * n'apparaissent pas ». Une série terminée puis reprise ne revenait jamais
 * dans « En cours » : le statut restait `completed` alors qu'une nouvelle
 * saison était sortie. Voir
 * reopenFinishedTvWithUnwatchedEpisodes() pour le détail.
 *
 * Tourne après le rafraîchissement nocturne, qui est ce qui fait entrer
 * les nouveaux épisodes : sans cet ordre, la tâche passerait avant d'avoir
 * de quoi travailler et il faudrait attendre le lendemain.
 */
export async function reopenFinishedTvJob(): Promise<void> {
  const rouvertes = await reopenFinishedTvWithUnwatchedEpisodes();
  if (rouvertes.length === 0) return;
  logReopen.info(
    `${rouvertes.length} série(s) rouverte(s) : de nouveaux épisodes sont arrivés depuis qu'elles avaient été finies`,
  );
}
