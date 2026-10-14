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
