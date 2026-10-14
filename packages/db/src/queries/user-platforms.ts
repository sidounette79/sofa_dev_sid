import { asc, desc, eq, inArray } from "drizzle-orm";

import { db } from "../client";
import { platformTmdbIds, platforms, userPlatforms } from "../schema";

export async function getUserPlatformIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ platformId: userPlatforms.platformId })
    .from(userPlatforms)
    .where(eq(userPlatforms.userId, userId));
  return rows.map((r) => r.platformId);
}

export function getUserPlatforms(userId: string) {
  return db
    .select({
      id: platforms.id,
      name: platforms.name,
      logoPath: platforms.logoPath,
      urlTemplate: platforms.urlTemplate,
      isSubscription: platforms.isSubscription,
    })
    .from(userPlatforms)
    .innerJoin(platforms, eq(userPlatforms.platformId, platforms.id))
    .where(eq(userPlatforms.userId, userId))
    .orderBy(desc(platforms.isSubscription), asc(platforms.name));
}

export async function setUserPlatforms(userId: string, platformIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userPlatforms).where(eq(userPlatforms.userId, userId));
    if (platformIds.length > 0) {
      await tx
        .insert(userPlatforms)
        .values(platformIds.map((platformId) => ({ userId, platformId })))
        .onConflictDoNothing();
    }
  });
}

export function getAllPlatforms() {
  return db.select().from(platforms).orderBy(desc(platforms.isSubscription), asc(platforms.name));
}

export async function hasUserPlatforms(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ platformId: userPlatforms.platformId })
    .from(userPlatforms)
    .where(eq(userPlatforms.userId, userId))
    .limit(1);
  return row != null;
}

export async function platformIdsExist(platformIds: string[]): Promise<boolean> {
  if (platformIds.length === 0) return true;
  const unique = [...new Set(platformIds)];
  const found = await db.select({ id: platforms.id }).from(platforms).where(inArray(platforms.id, unique));
  return found.length === unique.length;
}

export async function getTmdbProviderIdsForPlatform(platformId: string): Promise<number[]> {
  const rows = await db
    .select({ tmdbProviderId: platformTmdbIds.tmdbProviderId })
    .from(platformTmdbIds)
    .where(eq(platformTmdbIds.platformId, platformId));
  return rows.map((r) => r.tmdbProviderId);
}

export async function getTmdbProviderIdsByPlatformIds(
  platformIds: string[],
): Promise<Map<string, number[]>> {
  if (platformIds.length === 0) return new Map();
  const rows = await db
    .select({
      platformId: platformTmdbIds.platformId,
      tmdbProviderId: platformTmdbIds.tmdbProviderId,
    })
    .from(platformTmdbIds)
    .where(inArray(platformTmdbIds.platformId, platformIds));

  const map = new Map<string, number[]>();
  for (const row of rows) {
    const arr = map.get(row.platformId) ?? [];
    arr.push(row.tmdbProviderId);
    map.set(row.platformId, arr);
  }
  return map;
}
