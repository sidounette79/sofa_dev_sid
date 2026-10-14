import {
  getAllPlatforms,
  getTmdbProviderIdsByPlatformIds,
  getTmdbProviderIdsForPlatform,
  getUserPlatformIds,
  getUserPlatforms,
  hasUserPlatforms,
  platformIdsExist,
  setUserPlatforms,
} from "@sofa/db/queries/user-platforms";

export function listPlatforms() {
  return getAllPlatforms();
}

export function getUserPlatformList(userId: string) {
  return getUserPlatforms(userId);
}

export function getUserPlatformIdList(userId: string) {
  return getUserPlatformIds(userId);
}

export async function updateUserPlatforms(userId: string, platformIds: string[]): Promise<void> {
  if (platformIds.length > 0 && !(await platformIdsExist(platformIds))) {
    throw new Error("One or more platform IDs do not exist");
  }
  await setUserPlatforms(userId, platformIds);
}

export function hasUserSetPlatforms(userId: string): Promise<boolean> {
  return hasUserPlatforms(userId);
}

export function getPlatformTmdbIds(platformId: string): Promise<number[]> {
  return getTmdbProviderIdsForPlatform(platformId);
}

export function getPlatformTmdbIdMap(platformIds: string[]): Promise<Map<string, number[]>> {
  return getTmdbProviderIdsByPlatformIds(platformIds);
}
