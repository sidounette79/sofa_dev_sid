import { eq } from "drizzle-orm";

import { db } from "../client";
import { episodes, persons, seasons, titles } from "../schema";

export async function updateTitlePosterThumbHash(
  titleId: string,
  hash: string | null,
): Promise<void> {
  await db.update(titles).set({ posterThumbHash: hash }).where(eq(titles.id, titleId));
}

export async function updateTitleBackdropThumbHash(
  titleId: string,
  hash: string | null,
): Promise<void> {
  await db.update(titles).set({ backdropThumbHash: hash }).where(eq(titles.id, titleId));
}

export async function updateSeasonPosterThumbHash(
  seasonId: string,
  hash: string | null,
): Promise<void> {
  await db.update(seasons).set({ posterThumbHash: hash }).where(eq(seasons.id, seasonId));
}

export async function updateEpisodeStillThumbHash(
  episodeId: string,
  hash: string | null,
): Promise<void> {
  await db.update(episodes).set({ stillThumbHash: hash }).where(eq(episodes.id, episodeId));
}

export async function updatePersonProfileThumbHash(
  personId: string,
  hash: string | null,
): Promise<void> {
  await db.update(persons).set({ profileThumbHash: hash }).where(eq(persons.id, personId));
}
