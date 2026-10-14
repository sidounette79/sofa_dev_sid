import { eq, inArray, sql } from "drizzle-orm";

import { db } from "../client";
import { persons, titleCast } from "../schema";

interface PersonData {
  tmdbId: number;
  name: string;
  profilePath: string | null;
  popularity?: number;
}

export function getExistingPersonsByTmdbIds(tmdbIds: number[]) {
  if (tmdbIds.length === 0) return Promise.resolve([]);
  return db
    .select({
      id: persons.id,
      tmdbId: persons.tmdbId,
      name: persons.name,
      profilePath: persons.profilePath,
      profileThumbHash: persons.profileThumbHash,
      popularity: persons.popularity,
    })
    .from(persons)
    .where(inArray(persons.tmdbId, tmdbIds))
    ;
}

export async function batchUpsertPersonsTransaction(
  uniquePeople: PersonData[],
  existingMap: Map<number, Awaited<ReturnType<typeof getExistingPersonsByTmdbIds>>[number]>,
): Promise<Map<number, string>> {
  const idMap = new Map<number, string>();
  for (const [tmdbId, p] of existingMap) {
    idMap.set(tmdbId, p.id);
  }

  await db.transaction(async (tx) => {
    for (const p of uniquePeople) {
      const existingPerson = existingMap.get(p.tmdbId);
      if (existingPerson) {
        const nextPopularity = p.popularity ?? null;
        const pathChanged = existingPerson.profilePath !== p.profilePath;
        const needsUpdate =
          existingPerson.name !== p.name ||
          pathChanged ||
          existingPerson.popularity !== nextPopularity;
        if (!needsUpdate) continue;

        await tx
          .update(persons)
          .set({
            name: p.name,
            profilePath: p.profilePath,
            popularity: nextPopularity,
            profileThumbHash: pathChanged ? null : existingPerson.profileThumbHash,
          })
          .where(eq(persons.id, existingPerson.id));
        continue;
      }

      const [row] = await tx
        .insert(persons)
        .values({
          tmdbId: p.tmdbId,
          name: p.name,
          profilePath: p.profilePath,
          popularity: p.popularity ?? null,
        })
        .onConflictDoNothing()
        .returning();
      if (row) idMap.set(p.tmdbId, row.id);
    }
  });

  return idMap;
}

export function getFallbackPersonsByTmdbIds(tmdbIds: number[]) {
  if (tmdbIds.length === 0) return Promise.resolve([]);
  return db
    .select({ id: persons.id, tmdbId: persons.tmdbId })
    .from(persons)
    .where(inArray(persons.tmdbId, tmdbIds))
    ;
}

export function getPersonsForTitleCast(titleId: string) {
  return db
    .select({
      id: persons.id,
      profilePath: persons.profilePath,
      profileThumbHash: persons.profileThumbHash,
    })
    .from(titleCast)
    .innerJoin(persons, eq(titleCast.personId, persons.id))
    .where(eq(titleCast.titleId, titleId))
    ;
}

export async function batchUpsertTitleCast(rows: (typeof titleCast.$inferInsert)[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(titleCast)
    .values(rows)
    .onConflictDoUpdate({
      target: [titleCast.titleId, titleCast.personId, titleCast.department, titleCast.character],
      set: {
        job: sql`excluded.job`,
        displayOrder: sql`excluded."displayOrder"`,
        episodeCount: sql`excluded."episodeCount"`,
        lastFetchedAt: sql`excluded."lastFetchedAt"`,
      },
    });
}

export function getCastForTitleJoined(titleId: string) {
  return db
    .select({
      id: titleCast.id,
      personId: titleCast.personId,
      name: persons.name,
      character: titleCast.character,
      department: titleCast.department,
      job: titleCast.job,
      displayOrder: titleCast.displayOrder,
      episodeCount: titleCast.episodeCount,
      profilePath: persons.profilePath,
      profileThumbHash: persons.profileThumbHash,
      tmdbId: persons.tmdbId,
    })
    .from(titleCast)
    .innerJoin(persons, eq(titleCast.personId, persons.id))
    .where(eq(titleCast.titleId, titleId))
    .orderBy(titleCast.displayOrder)
    ;
}
