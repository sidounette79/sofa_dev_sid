import { and, count, desc, eq, ne, notInArray, sql } from "drizzle-orm";

import { db } from "../client";
import { titles, userEmbyLibraries, userTitleStatus } from "../schema";

export interface EmbyLibraryMatch {
  titleId: string;
  embyItemId: string;
  embyLibraryName: string;
}

export type EmbyAvailabilityStatus = "available" | "removed" | null;

/** Derive the 3-state Emby availability from the raw title columns. */
export function deriveEmbyStatus(
  inEmbyLibrary: boolean,
  embyItemId: string | null,
): EmbyAvailabilityStatus {
  if (inEmbyLibrary) return "available";
  if (embyItemId) return "removed";
  return null;
}

export async function markTitlesInEmbyLibrary(matches: EmbyLibraryMatch[]): Promise<void> {
  if (matches.length === 0) return;
  await db.transaction(async (tx) => {
    for (const m of matches) {
      // 01.11, Sid (Brothers AND The Lowdown both ended up with two
      // inEmbyLibrary=true title rows sharing the same embyItemId after a
      // routine scan): resolveItemTmdbId's title+year fallback isn't
      // guaranteed to return the same tmdbId every scan for an ambiguous
      // title, so a later scan can land this same Emby item on a
      // DIFFERENT title row than a previous scan did. clearStaleEmbyLibraryFlags
      // only clears titles whose embyItemId wasn't seen at all this scan -
      // it has no way to know the id moved to a different title row,
      // so the old one just sits there forever also claiming "in library".
      // Clearing any other title currently holding this exact embyItemId
      // before setting it here keeps the invariant that at most one title
      // can claim a given real Emby item at a time, regardless of how many
      // times the resolution flip-flops.
      await tx
        .update(titles)
        .set({ inEmbyLibrary: false })
        .where(and(eq(titles.embyItemId, m.embyItemId), ne(titles.id, m.titleId)));
      await tx
        .update(titles)
        .set({
          inEmbyLibrary: true,
          embyItemId: m.embyItemId,
          embyLibraryName: m.embyLibraryName,
        })
        .where(eq(titles.id, m.titleId));
    }
  });
}

/**
 * Real-time counterpart to `clearStaleEmbyLibraryFlags` — Emby's
 * "library.deleted" webhook fires per-item, so a single title can be
 * flipped to "removed" immediately instead of waiting for the next full
 * scan's reconciliation pass. Keeps embyItemId/embyLibraryName, same as
 * the bulk version, so the UI can still tell "removed" apart from "never
 * seen".
 */
export async function clearSingleEmbyLibraryFlag(embyItemId: string): Promise<boolean> {
  const result = await db
    .update(titles)
    .set({ inEmbyLibrary: false })
    .where(and(eq(titles.inEmbyLibrary, true), eq(titles.embyItemId, embyItemId)));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Any title currently flagged inEmbyLibrary whose embyItemId is not in the
 * given set of currently-seen item IDs is no longer on the server — clear
 * the flag. Item IDs are per-Emby-instance and stable, so this is a safe
 * reconciliation check after a full scan.
 */
export async function clearStaleEmbyLibraryFlags(currentEmbyItemIds: string[]): Promise<number> {
  // Keep embyItemId/embyLibraryName so the UI can tell "removed" apart from
  // "never seen" — only flip the availability flag.
  const result = await db
    .update(titles)
    .set({ inEmbyLibrary: false })
    .where(
      and(
        eq(titles.inEmbyLibrary, true),
        currentEmbyItemIds.length > 0
          ? notInArray(titles.embyItemId, currentEmbyItemIds)
          : undefined,
      ),
    );
  return result.rowCount ?? 0;
}

/** Titles physically in the Emby library that the user hasn't tracked yet
 * (no watchlist/watching/completed/dropped status) — the "not started yet /
 * available" feed shown on the dashboard. */
export async function getUntrackedEmbyLibraryTitleIds(
  userId: string,
  limit = 50,
  type?: "movie" | "tv",
): Promise<string[]> {
  const rows = await db
    .select({ id: titles.id })
    .from(titles)
    .where(
      and(
        eq(titles.inEmbyLibrary, true),
        type ? eq(titles.type, type) : undefined,
        sql`NOT EXISTS (
          SELECT 1 FROM ${userTitleStatus}
          WHERE ${userTitleStatus.titleId} = ${titles.id}
            AND ${userTitleStatus.userId} = ${userId}
        )`,
      ),
    )
    .orderBy(desc(titles.lastFetchedAt))
    .limit(limit);
  return rows.map((r) => r.id);
}

// 26.08, Sid — the dashboard section built on getUntrackedEmbyLibraryTitleIds
// showed items.length (capped at the feed's limit) as its header count,
// understating the real total whenever more than `limit` titles matched.
// Same WHERE clause, real COUNT(*) instead of a capped SELECT.
export async function getUntrackedEmbyLibraryCount(
  userId: string,
  type?: "movie" | "tv",
): Promise<number> {
  const [result] = await db
    .select({ count: count() })
    .from(titles)
    .where(
      and(
        eq(titles.inEmbyLibrary, true),
        type ? eq(titles.type, type) : undefined,
        sql`NOT EXISTS (
          SELECT 1 FROM ${userTitleStatus}
          WHERE ${userTitleStatus.titleId} = ${titles.id}
            AND ${userTitleStatus.userId} = ${userId}
        )`,
      ),
    );
  return result?.count ?? 0;
}

export async function setUserEmbyLibraries(userId: string, libraryNames: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userEmbyLibraries).where(eq(userEmbyLibraries.userId, userId));
    if (libraryNames.length > 0) {
      await tx
        .insert(userEmbyLibraries)
        .values(libraryNames.map((name) => ({ userId, embyLibraryName: name })))
        .onConflictDoNothing();
    }
  });
}

export async function getUserEmbyLibraries(userId: string): Promise<string[]> {
  const rows = await db
    .select({ embyLibraryName: userEmbyLibraries.embyLibraryName })
    .from(userEmbyLibraries)
    .where(eq(userEmbyLibraries.userId, userId));
  return rows.map((r) => r.embyLibraryName);
}

/** Map of Emby library name -> Sofa user IDs who have claimed that library as theirs. */
export async function getEmbyLibraryOwnersMap(): Promise<Map<string, string[]>> {
  const rows = await db
    .select({
      embyLibraryName: userEmbyLibraries.embyLibraryName,
      userId: userEmbyLibraries.userId,
    })
    .from(userEmbyLibraries);
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const arr = map.get(row.embyLibraryName) ?? [];
    arr.push(row.userId);
    map.set(row.embyLibraryName, arr);
  }
  return map;
}

/** Titles physically found in a specific Emby library. */
export async function getTitleIdsByEmbyLibraryName(embyLibraryName: string): Promise<string[]> {
  const rows = await db
    .select({ id: titles.id })
    .from(titles)
    .where(and(eq(titles.inEmbyLibrary, true), eq(titles.embyLibraryName, embyLibraryName)));
  return rows.map((r) => r.id);
}
