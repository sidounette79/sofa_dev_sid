import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";

import { createLogger } from "@sofa/logger";

import { db } from "./client";
import platformData from "./platforms.json";
import { platformTmdbIds, platforms, titleAvailability, userPlatforms } from "./schema";

const log = createLogger("seed-platforms");

export interface SeedPlatform {
  tmdbProviderIds: number[];
  name: string;
  logoPath: string | null;
  urlTemplate: string;
  isSubscription: boolean;
}

export const SEED_DATA: SeedPlatform[] = platformData;

export async function seedPlatforms(): Promise<void> {
  log.debug(`Seeding ${SEED_DATA.length} platforms`);

  await db.transaction(async (tx) => {
    const existingPlatforms = new Map(
      (await tx.select().from(platforms)).map((p) => [p.id, p]),
    );
    const existingMappings = await tx.select().from(platformTmdbIds);
    const tmdbToPlatform = new Map(existingMappings.map((m) => [m.tmdbProviderId, m.platformId]));

    for (const seed of SEED_DATA) {
      // Find all existing platform IDs that any of this seed's TMDB IDs map to
      const existingPlatformIds = [
        ...new Set(
          seed.tmdbProviderIds
            .map((id) => tmdbToPlatform.get(id))
            .filter((id): id is string => id != null),
        ),
      ];

      let canonicalId: string;

      if (existingPlatformIds.length === 0) {
        // Brand new platform
        canonicalId = uuidv7();
        await tx.insert(platforms).values({
          id: canonicalId,
          name: seed.name,
          logoPath: seed.logoPath,
          urlTemplate: seed.urlTemplate,
          isSubscription: seed.isSubscription,
        });
        log.debug(`Created platform "${seed.name}"`);
      } else {
        // Use the first existing platform as canonical
        canonicalId = existingPlatformIds[0]!;

        // Only update if metadata actually changed
        const existing = existingPlatforms.get(canonicalId);
        if (
          !existing ||
          existing.name !== seed.name ||
          existing.logoPath !== seed.logoPath ||
          existing.urlTemplate !== seed.urlTemplate ||
          existing.isSubscription !== seed.isSubscription
        ) {
          await tx
            .update(platforms)
            .set({
              name: seed.name,
              logoPath: seed.logoPath,
              urlTemplate: seed.urlTemplate,
              isSubscription: seed.isSubscription,
            })
            .where(eq(platforms.id, canonicalId));
          log.debug(`Updated platform "${seed.name}"`);
        }

        // Merge duplicates into the canonical platform
        for (const oldId of existingPlatformIds.slice(1)) {
          // 08.10, Postgres migration: SQLite's `UPDATE OR IGNORE` silently
          // skipped rows that would violate the unique constraint after
          // re-pointing - Postgres has no UPDATE-side equivalent, so the
          // conflicting rows are deleted first (same effect: the canonical
          // platform's own row wins, the duplicate's is dropped), then the
          // rest can be updated with no possible conflict left.
          await tx
            .delete(titleAvailability)
            .where(
              and(
                eq(titleAvailability.platformId, oldId),
                sql`EXISTS (
                  SELECT 1 FROM ${titleAvailability} AS existing
                  WHERE existing."platformId" = ${canonicalId}
                    AND existing."titleId" = ${titleAvailability.titleId}
                    AND existing."offerType" = ${titleAvailability.offerType}
                    AND existing."region" = ${titleAvailability.region}
                )`,
              ),
            );
          await tx
            .update(titleAvailability)
            .set({ platformId: canonicalId })
            .where(eq(titleAvailability.platformId, oldId));

          await tx
            .delete(userPlatforms)
            .where(
              and(
                eq(userPlatforms.platformId, oldId),
                sql`EXISTS (
                  SELECT 1 FROM ${userPlatforms} AS existing
                  WHERE existing."platformId" = ${canonicalId}
                    AND existing."userId" = ${userPlatforms.userId}
                )`,
              ),
            );
          await tx
            .update(userPlatforms)
            .set({ platformId: canonicalId })
            .where(eq(userPlatforms.platformId, oldId));

          // Remove old TMDB ID mappings (cascade won't fire since we delete platform next)
          await tx.delete(platformTmdbIds).where(eq(platformTmdbIds.platformId, oldId));

          // Delete the duplicate platform
          await tx.delete(platforms).where(eq(platforms.id, oldId));
          log.debug(`Merged duplicate platform ${oldId} into "${seed.name}" (${canonicalId})`);
        }
      }

      // Batch insert missing TMDB ID mappings
      const missingTmdbIds = seed.tmdbProviderIds.filter(
        (id) => tmdbToPlatform.get(id) !== canonicalId,
      );
      if (missingTmdbIds.length > 0) {
        await tx
          .insert(platformTmdbIds)
          .values(
            missingTmdbIds.map((tmdbProviderId) => ({ platformId: canonicalId, tmdbProviderId })),
          )
          .onConflictDoNothing();
        log.debug(`Added ${missingTmdbIds.length} TMDB mapping(s) for "${seed.name}"`);
      }
    }
  });

  log.debug(`Seeded ${SEED_DATA.length} platforms`);
}
