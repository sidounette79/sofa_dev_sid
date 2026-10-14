import { inArray, isNull, notInArray } from "drizzle-orm";

import { db } from "../client";
import { episodes, persons, seasons, titleCast, titles, userTitleStatus } from "../schema";

const BATCH_SIZE = 500;

export interface OrphanedImage {
  category: "posters" | "backdrops" | "stills" | "profiles";
  path: string;
}

export interface PurgeResult {
  deletedTitles: number;
  deletedPersons: number;
  orphanedImages: OrphanedImage[];
}

/** Collect all cached image paths associated with a set of title IDs. */
async function collectTitleImagePaths(titleIds: string[]): Promise<OrphanedImage[]> {
  const images: OrphanedImage[] = [];

  for (let i = 0; i < titleIds.length; i += BATCH_SIZE) {
    const batch = titleIds.slice(i, i + BATCH_SIZE);

    // Title posters + backdrops
    const titleRows = await db
      .select({ posterPath: titles.posterPath, backdropPath: titles.backdropPath })
      .from(titles)
      .where(inArray(titles.id, batch));
    for (const r of titleRows) {
      if (r.posterPath) images.push({ category: "posters", path: r.posterPath });
      if (r.backdropPath) images.push({ category: "backdrops", path: r.backdropPath });
    }

    // Season posters + IDs
    const seasonRows = await db
      .select({ id: seasons.id, posterPath: seasons.posterPath })
      .from(seasons)
      .where(inArray(seasons.titleId, batch));
    for (const r of seasonRows) {
      if (r.posterPath) images.push({ category: "posters", path: r.posterPath });
    }

    // Episode stills (via seasons)
    const seasonIds = seasonRows.map((s) => s.id);

    for (let j = 0; j < seasonIds.length; j += BATCH_SIZE) {
      const sBatch = seasonIds.slice(j, j + BATCH_SIZE);
      const epRows = await db
        .select({ stillPath: episodes.stillPath })
        .from(episodes)
        .where(inArray(episodes.seasonId, sBatch));
      for (const r of epRows) {
        if (r.stillPath) images.push({ category: "stills", path: r.stillPath });
      }
    }
  }

  return images;
}

/** Find person IDs that have no remaining titleCast entries. */
async function getOrphanedPersonIds(): Promise<string[]> {
  const rows = await db
    .select({ id: persons.id })
    .from(persons)
    .where(
      notInArray(persons.id, db.selectDistinct({ personId: titleCast.personId }).from(titleCast)),
    );
  return rows.map((p) => p.id);
}

/** Collect profile paths for a set of orphaned person IDs. */
async function collectOrphanedPersonImages(orphanedIds: string[]): Promise<OrphanedImage[]> {
  if (orphanedIds.length === 0) return [];
  const images: OrphanedImage[] = [];
  for (let i = 0; i < orphanedIds.length; i += BATCH_SIZE) {
    const batch = orphanedIds.slice(i, i + BATCH_SIZE);
    const rows = await db
      .select({ profilePath: persons.profilePath })
      .from(persons)
      .where(inArray(persons.id, batch));
    for (const r of rows) {
      if (r.profilePath) images.push({ category: "profiles", path: r.profilePath });
    }
  }
  return images;
}

/** Delete orphaned persons by IDs, returning the count deleted. */
async function deleteOrphanedPersons(orphanedIds: string[]): Promise<number> {
  if (orphanedIds.length === 0) return 0;
  for (let i = 0; i < orphanedIds.length; i += BATCH_SIZE) {
    const batch = orphanedIds.slice(i, i + BATCH_SIZE);
    await db.delete(persons).where(inArray(persons.id, batch));
  }
  return orphanedIds.length;
}

export async function purgeShellTitlesTransaction(): Promise<PurgeResult> {
  return db.transaction(async (tx) => {
    const shellTitles = await tx
      .select({ id: titles.id })
      .from(titles)
      .where(isNull(titles.lastFetchedAt));

    if (shellTitles.length === 0) {
      const orphanedIds = await getOrphanedPersonIds();
      const orphanedImages = await collectOrphanedPersonImages(orphanedIds);
      return {
        deletedTitles: 0,
        deletedPersons: await deleteOrphanedPersons(orphanedIds),
        orphanedImages,
      };
    }

    const libraryRows = await tx.select({ titleId: userTitleStatus.titleId }).from(userTitleStatus);
    const libraryTitleIds = new Set(libraryRows.map((r) => r.titleId));

    const toDelete = shellTitles.map((t) => t.id).filter((id) => !libraryTitleIds.has(id));

    if (toDelete.length === 0) {
      const orphanedIds = await getOrphanedPersonIds();
      const orphanedImages = await collectOrphanedPersonImages(orphanedIds);
      return {
        deletedTitles: 0,
        deletedPersons: await deleteOrphanedPersons(orphanedIds),
        orphanedImages,
      };
    }

    // Collect image paths BEFORE cascade-deleting the title rows
    const orphanedImages = await collectTitleImagePaths(toDelete);

    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
      const batch = toDelete.slice(i, i + BATCH_SIZE);
      await tx.delete(titles).where(inArray(titles.id, batch));
    }

    // After title cascade deletes, find orphaned persons once and use for both operations
    const orphanedIds = await getOrphanedPersonIds();
    orphanedImages.push(...(await collectOrphanedPersonImages(orphanedIds)));
    return {
      deletedTitles: toDelete.length,
      deletedPersons: await deleteOrphanedPersons(orphanedIds),
      orphanedImages,
    };
  });
}

export async function purgeOrphanedPersons(): Promise<number> {
  return deleteOrphanedPersons(await getOrphanedPersonIds());
}
