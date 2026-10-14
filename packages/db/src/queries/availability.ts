import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { db } from "../client";
import { platformTmdbIds, platforms, titleAvailability } from "../schema";

export async function replaceAvailabilityTransaction(
  titleId: string,
  region: string,
  offers: (typeof titleAvailability.$inferInsert)[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(titleAvailability)
      .where(and(eq(titleAvailability.titleId, titleId), eq(titleAvailability.region, region)));

    if (offers.length > 0) {
      await tx.insert(titleAvailability).values(offers).onConflictDoNothing();
    }
  });
}

export function getAvailabilityForTitle(titleId: string) {
  return db
    .select({
      platformId: platforms.id,
      providerName: platforms.name,
      logoPath: platforms.logoPath,
      urlTemplate: platforms.urlTemplate,
      offerType: titleAvailability.offerType,
    })
    .from(titleAvailability)
    .innerJoin(platforms, eq(titleAvailability.platformId, platforms.id))
    .where(eq(titleAvailability.titleId, titleId));
}

/**
 * Ensure a platform row exists for a TMDB provider.
 * Looks up via the platformTmdbIds junction table.
 * Uses a transaction to prevent orphaned platform rows under concurrent refreshes.
 * Returns the platform ID.
 */
export async function ensurePlatformForTmdbProvider(
  tmdbProviderId: number,
  name: string,
  logoPath: string | null,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ platformId: platformTmdbIds.platformId })
      .from(platformTmdbIds)
      .where(eq(platformTmdbIds.tmdbProviderId, tmdbProviderId));

    if (existing) {
      await tx.update(platforms).set({ logoPath }).where(eq(platforms.id, existing.platformId));
      return existing.platformId;
    }

    const id = uuidv7();
    await tx.insert(platforms).values({ id, name, logoPath });
    await tx
      .insert(platformTmdbIds)
      .values({ platformId: id, tmdbProviderId })
      .onConflictDoNothing();

    // Verify our insert won (handles race with another writer)
    const [mapping] = await tx
      .select({ platformId: platformTmdbIds.platformId })
      .from(platformTmdbIds)
      .where(eq(platformTmdbIds.tmdbProviderId, tmdbProviderId));

    if (!mapping) {
      throw new Error(`Platform mapping for TMDB provider ${tmdbProviderId} vanished mid-transaction`);
    }

    if (mapping.platformId !== id) {
      // Another transaction beat us — clean up our orphan
      await tx.delete(platforms).where(eq(platforms.id, id));
      await tx.update(platforms).set({ logoPath }).where(eq(platforms.id, mapping.platformId));
    }

    return mapping.platformId;
  });
}
