import { and, count, desc, eq, inArray, sql } from "drizzle-orm";

import { db } from "../client";
import {
  episodes,
  seasons,
  titles,
  userEpisodeWatches,
  userMovieWatches,
} from "../schema";

export function getTitleById(titleId: string) {
  return db.select().from(titles).where(eq(titles.id, titleId));
}

export function getExistingTitlesByTmdbIds(tmdbIds: number[]) {
  if (tmdbIds.length === 0) return Promise.resolve([]);
  return db.select().from(titles).where(inArray(titles.tmdbId, tmdbIds));
}

export function getExistingTitlesByTvdbIds(tvdbIds: number[]) {
  if (tvdbIds.length === 0) return Promise.resolve([]);
  return db.select().from(titles).where(inArray(titles.tvdbId, tvdbIds));
}

/** Bulk variant of markTitleRequested, for the Radarr/Sonarr reconciliation sync. */
export async function markTitlesRequested(updates: { titleId: string; at: Date }[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const { titleId, at } of updates) {
      await tx
        .update(titles)
        .set({ requestedAt: at, requestedByUserId: null })
        .where(eq(titles.id, titleId));
    }
  });
}

/** Household-wide "requested" flag — see schema.ts's titles.requestedAt doc comment. */
export async function markTitleRequested(
  titleId: string,
  userId: string | null,
  at?: Date,
): Promise<void> {
  await db
    .update(titles)
    .set({ requestedAt: at ?? new Date(), requestedByUserId: userId })
    .where(eq(titles.id, titleId));
}

// 15.10, Sid ("un lien faisable par radarr et sonarr?"): the reverse of
// syncRequestedFromRadarrSonarr's backfill - a title she gives up on and
// deletes straight in Radarr/Sonarr (too old, unfindable in French, a
// duplicate of something already watched...) should stop showing as
// pending here too, without a separate manual action. Same "pending"
// definition as the Requests page itself (getRequestedTitles): requested,
// never seen in Emby at all.
export function getPendingRequestedTitleIds() {
  return db
    .select({ id: titles.id, type: titles.type, tmdbId: titles.tmdbId, tvdbId: titles.tvdbId })
    .from(titles)
    .where(
      and(
        sql`${titles.requestedAt} is not null`,
        eq(titles.inEmbyLibrary, false),
        sql`${titles.embyItemId} is null`,
      ),
    );
}

export async function clearTitlesRequested(titleIds: string[]): Promise<void> {
  if (titleIds.length === 0) return;
  await db
    .update(titles)
    .set({ requestedAt: null, requestedByUserId: null })
    .where(inArray(titles.id, titleIds));
}

export function findSeasonByTitleAndNumber(titleId: string, seasonNumber: number) {
  return db
    .select()
    .from(seasons)
    .where(and(eq(seasons.titleId, titleId), eq(seasons.seasonNumber, seasonNumber)));
}

export function findEpisodeBySeasonAndNumber(seasonId: string, episodeNumber: number) {
  return db
    .select()
    .from(episodes)
    .where(and(eq(episodes.seasonId, seasonId), eq(episodes.episodeNumber, episodeNumber)));
}

export async function getTitleCount(): Promise<number> {
  const [result] = await db.select({ count: count() }).from(titles);
  return result?.count ?? 0;
}

/**
 * Requested (via Sofa's Request button or reconciled from Radarr/Sonarr
 * directly, see media-requests.ts) but not yet on Emby — the "Demandé - pas
 * dispo" section (24.08, Sid). Deliberately narrower than "on my watchlist
 * with nothing downloaded" (which she asked to remove — too vague, could be
 * "never" for something never actually requested): this is scoped to a real
 * request having gone out, which at least means Radarr/Sonarr are actively
 * searching for it.
 */
export function getRequestedNotAvailable(type: "movie" | "tv", limit = 20) {
  return db
    .select()
    .from(titles)
    .where(
      and(
        eq(titles.type, type),
        eq(titles.inEmbyLibrary, false),
        sql`${titles.requestedAt} IS NOT NULL`,
      ),
    )
    .orderBy(desc(titles.requestedAt))
    .limit(limit);
}

/**
 * Les N derniers titres vus par un utilisateur, films ou episodes.
 *
 * 18.11, Sid : « on pourrait avoir, quelque part dans la page des series et
 * aussi des films, un resume des 10 derniers trucs vus ? Sous forme de
 * liste ? ». Les deux tables de visionnage existaient et n'etaient lues que
 * pour des compteurs; rien n'exposait l'historique lui-meme.
 *
 * Un episode revu (cycle 2+) compte comme un visionnage a part entiere, mais
 * on ne garde que la derniere occurrence par titre pour ne pas remplir la
 * liste avec la meme serie.
 */
export async function getRecentWatches(
  userId: string,
  type: "movie" | "tv",
  limit = 10,
) {
  // 18.11, Sid : « est-ce que ca ralentit le chargement de toute la page ?
  // Parce qu'on a lutte des mois pour que ca arrete de ramer ». Question
  // justifiee: la premiere version agregeait TOUT l'historique avant de
  // trier et d'en garder dix - EXPLAIN montrait un Seq Scan sur les 175 794
  // episodes et les 39 809 visionnages, 240 ms pour afficher dix lignes.
  // Exactement le motif qui a fait ramer Sofa pendant des mois.
  //
  // On lit d'abord les derniers visionnages par l'index
  // (userId, watchedAt), puis on joint seulement ceux-la: plus aucun Seq
  // Scan, 11 ms stables. La fenetre est large (40x la limite demandee) pour
  // qu'une serie regardee d'affilee ne masque pas les titres precedents.
  const window = Math.max(limit * 40, 400);

  if (type === "movie") {
    return db
      .select({
        titleId: titles.id,
        name: titles.title,
        posterPath: titles.posterPath,
        tmdbId: titles.tmdbId,
        watchedAt: sql<Date>`max(recent."watchedAt")`.as("watchedAt"),
      })
      .from(
        sql`(
          select "titleId", "watchedAt"
          from ${userMovieWatches}
          where "userId" = ${userId}
          order by "watchedAt" desc
          limit ${window}
        ) as recent`,
      )
      .innerJoin(titles, sql`${titles.id} = recent."titleId"`)
      .groupBy(titles.id, titles.title, titles.posterPath, titles.tmdbId)
      .orderBy(desc(sql`max(recent."watchedAt")`))
      .limit(limit);
  }

  return db
    .select({
      titleId: titles.id,
      name: titles.title,
      posterPath: titles.posterPath,
      tmdbId: titles.tmdbId,
      watchedAt: sql<Date>`max(recent."watchedAt")`.as("watchedAt"),
    })
    .from(
      sql`(
        select "episodeId", "watchedAt"
        from ${userEpisodeWatches}
        where "userId" = ${userId}
        order by "watchedAt" desc
        limit ${window}
      ) as recent`,
    )
    .innerJoin(episodes, sql`${episodes.id} = recent."episodeId"`)
    .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
    .innerJoin(titles, eq(titles.id, seasons.titleId))
    .groupBy(titles.id, titles.title, titles.posterPath, titles.tmdbId)
    .orderBy(desc(sql`max(recent."watchedAt")`))
    .limit(limit);
}
