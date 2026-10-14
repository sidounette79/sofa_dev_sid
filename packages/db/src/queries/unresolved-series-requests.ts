import { and, eq } from "drizzle-orm";

import { db } from "../client";
import { titles, unresolvedSeriesRequests } from "../schema";

export interface UnresolvedSeriesRequestInput {
  userId: string;
  titleId: string;
  requestedByName: string;
  reason: string;
  rootFolderPath: string | null;
  qualityProfileId: number | null;
  seasonNumbers: number[] | null;
}

/** Upsert on (userId, titleId) — a repeated failure just refreshes the reason/timestamp. */
export function upsertUnresolvedSeriesRequest(input: UnresolvedSeriesRequestInput) {
  const values = {
    userId: input.userId,
    titleId: input.titleId,
    requestedByName: input.requestedByName,
    reason: input.reason,
    rootFolderPath: input.rootFolderPath,
    qualityProfileId: input.qualityProfileId,
    seasonNumbers: input.seasonNumbers ? JSON.stringify(input.seasonNumbers) : null,
    createdAt: new Date(),
  };
  return db
    .insert(unresolvedSeriesRequests)
    .values(values)
    .onConflictDoUpdate({
      target: [unresolvedSeriesRequests.userId, unresolvedSeriesRequests.titleId],
      set: {
        reason: values.reason,
        rootFolderPath: values.rootFolderPath,
        qualityProfileId: values.qualityProfileId,
        seasonNumbers: values.seasonNumbers,
        createdAt: values.createdAt,
      },
    })
    .returning()
    ;
}

/** Cleared once a retry (or any later successful request) goes through. */
export function deleteUnresolvedSeriesRequest(userId: string, titleId: string) {
  return db
    .delete(unresolvedSeriesRequests)
    .where(
      and(
        eq(unresolvedSeriesRequests.userId, userId),
        eq(unresolvedSeriesRequests.titleId, titleId),
      ),
    )
    ;
}

/**
 * For the "En attente TMDB" grid — title-card-shaped data, joined against
 * `titles`. Deliberately unbounded by date (unlike the Upcoming feed): the
 * whole point is that it stays visible after the expected air date passes,
 * until TheTVDB actually catches up and a retry succeeds.
 */
export function getUnresolvedSeriesRequestTitlesForUser(userId: string) {
  return db
    .select({
      id: titles.id,
      title: titles.title,
      posterPath: titles.posterPath,
      posterThumbHash: titles.posterThumbHash,
      firstAirDate: titles.firstAirDate,
      releaseDate: titles.releaseDate,
      voteAverage: titles.voteAverage,
    })
    .from(unresolvedSeriesRequests)
    .innerJoin(titles, eq(titles.id, unresolvedSeriesRequests.titleId))
    .where(eq(unresolvedSeriesRequests.userId, userId))
    .orderBy(titles.title)
    ;
}
