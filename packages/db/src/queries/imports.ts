import { and, eq, inArray } from "drizzle-orm";

import { db } from "../client";
import {
  importJobs,
  userEpisodeWatches,
  userMovieWatches,
  userRatings,
  userTitleStatus,
} from "../schema";

// ─── Existence checks (deduplication) ────────────────────────────────

export async function hasMovieWatch(userId: string, titleId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: userMovieWatches.id })
    .from(userMovieWatches)
    .where(and(eq(userMovieWatches.userId, userId), eq(userMovieWatches.titleId, titleId)));
  return !!existing;
}

export async function hasEpisodeWatch(userId: string, episodeId: string): Promise<boolean> {
  const [existing] = await db
    .select({ id: userEpisodeWatches.id })
    .from(userEpisodeWatches)
    .where(and(eq(userEpisodeWatches.userId, userId), eq(userEpisodeWatches.episodeId, episodeId)));
  return !!existing;
}

export async function hasTitleStatus(userId: string, titleId: string): Promise<boolean> {
  return !!(await getTitleStatusValue(userId, titleId));
}

export async function getTitleStatusValue(
  userId: string,
  titleId: string,
): Promise<"watchlist" | "in_progress" | "completed" | null> {
  const [existing] = await db
    .select({ status: userTitleStatus.status })
    .from(userTitleStatus)
    .where(and(eq(userTitleStatus.userId, userId), eq(userTitleStatus.titleId, titleId)));
  return (existing?.status as "watchlist" | "in_progress" | "completed") ?? null;
}

export async function hasRating(userId: string, titleId: string): Promise<boolean> {
  const [existing] = await db
    .select({ ratingStars: userRatings.ratingStars })
    .from(userRatings)
    .where(and(eq(userRatings.userId, userId), eq(userRatings.titleId, titleId)));
  return !!existing;
}

// ─── Import job CRUD ─────────────────────────────────────────────────

export function getImportJob(jobId: string) {
  return db.select().from(importJobs).where(eq(importJobs.id, jobId));
}

export async function updateImportJobProgress(
  jobId: string,
  values: Partial<typeof importJobs.$inferInsert>,
): Promise<void> {
  await db.update(importJobs).set(values).where(eq(importJobs.id, jobId));
}

export function getImportJobStatus(jobId: string) {
  return db.select({ status: importJobs.status }).from(importJobs).where(eq(importJobs.id, jobId));
}

export function insertImportJob(values: typeof importJobs.$inferInsert) {
  return db.insert(importJobs).values(values).returning();
}

export function getActiveImportJobForUser(userId: string) {
  return db
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.userId, userId), inArray(importJobs.status, ["pending", "running"])));
}

/** Mark any running/pending import jobs as errored — called on server startup to recover from crashes. */
export async function recoverStaleImportJobs(): Promise<number> {
  const updated = await db
    .update(importJobs)
    .set({
      status: "error",
      finishedAt: new Date(),
      errors: JSON.stringify(["Import interrupted by server restart"]),
    })
    .where(inArray(importJobs.status, ["pending", "running"]))
    .returning({ id: importJobs.id });
  return updated.length;
}
