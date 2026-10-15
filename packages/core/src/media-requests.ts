import {
  addMovie,
  getAllMovies,
  getMovieByTmdbId,
  getQualityProfiles as getRadarrQualityProfilesRaw,
  getRootFolders as getRadarrRootFoldersRaw,
} from "@sofa/radarr/client";
import {
  addSeries,
  getAllSeries,
  getQualityProfiles as getSonarrQualityProfilesRaw,
  getRootFolders as getSonarrRootFoldersRaw,
  getSeriesByTvdbId,
  lookupSeriesByTitle,
} from "@sofa/sonarr/client";
import { getTvDetails, getTvExternalIds } from "@sofa/tmdb/client";
import {
  getExistingTitlesByTmdbIds,
  getExistingTitlesByTvdbIds,
  getTitleById,
  markTitleRequested,
  markTitlesRequested,
} from "@sofa/db/queries/title";
import { batchUpdateTvdbIds } from "@sofa/db/queries/lists";
import { countRequestedTitles, getRequestedTitles } from "@sofa/db/queries/library";
import {
  deleteUnresolvedSeriesRequest,
  getUnresolvedSeriesRequestTitlesForUser,
  upsertUnresolvedSeriesRequest,
} from "@sofa/db/queries/unresolved-series-requests";
import {
  getUserRequestDefaults,
  listAllUserRequestDefaults,
  setUserRequestDefaults,
} from "@sofa/db/queries/user-request-defaults";
import { createLogger } from "@sofa/logger";

import { resolveShowTmdbId } from "./imports/resolve";
import { ensureBrowseTitlesExist } from "./metadata";
import { quickAddTitle } from "./tracking";

const log = createLogger("media-requests");

// Root folders / quality profiles barely change — same reasoning and TTL as
// the Hardcover catalog cache in watched-authors.ts (5 min), avoids hitting
// Radarr/Sonarr on every single "add" dialog open.
const OPTIONS_CACHE_TTL_MS = 5 * 60 * 1000;
let radarrOptionsCache: { data: RequestOptions["radarr"]; fetchedAt: number } | null = null;
let sonarrOptionsCache: { data: RequestOptions["sonarr"]; fetchedAt: number } | null = null;

export interface RequestOptions {
  radarr: { rootFolders: { path: string }[]; qualityProfiles: { id: number; name: string }[] };
  sonarr: { rootFolders: { path: string }[]; qualityProfiles: { id: number; name: string }[] };
}

/** Root folders + quality profiles for both, for the request dialog's dropdowns. */
export async function getRequestOptions(): Promise<RequestOptions> {
  if (!radarrOptionsCache || Date.now() - radarrOptionsCache.fetchedAt > OPTIONS_CACHE_TTL_MS) {
    const [rootFolders, qualityProfiles] = await Promise.all([
      getRadarrRootFoldersRaw(),
      getRadarrQualityProfilesRaw(),
    ]);
    radarrOptionsCache = {
      data: {
        rootFolders: rootFolders.map((f) => ({ path: f.path })),
        qualityProfiles: qualityProfiles.map((p) => ({ id: p.id, name: p.name })),
      },
      fetchedAt: Date.now(),
    };
  }
  if (!sonarrOptionsCache || Date.now() - sonarrOptionsCache.fetchedAt > OPTIONS_CACHE_TTL_MS) {
    const [rootFolders, qualityProfiles] = await Promise.all([
      getSonarrRootFoldersRaw(),
      getSonarrQualityProfilesRaw(),
    ]);
    sonarrOptionsCache = {
      data: {
        rootFolders: rootFolders.map((f) => ({ path: f.path })),
        qualityProfiles: qualityProfiles.map((p) => ({ id: p.id, name: p.name })),
      },
      fetchedAt: Date.now(),
    };
  }
  return { radarr: radarrOptionsCache.data, sonarr: sonarrOptionsCache.data };
}

export interface UserRequestDefaultsDto {
  radarrRootFolder: string | null;
  radarrQualityProfileId: number | null;
  sonarrRootFolder: string | null;
  sonarrQualityProfileId: number | null;
}

export async function getUserDefaults(userId: string): Promise<UserRequestDefaultsDto> {
  const [row] = await getUserRequestDefaults(userId);
  return {
    radarrRootFolder: row?.radarrRootFolder ?? null,
    radarrQualityProfileId: row?.radarrQualityProfileId ?? null,
    sonarrRootFolder: row?.sonarrRootFolder ?? null,
    sonarrQualityProfileId: row?.sonarrQualityProfileId ?? null,
  };
}

/** Admin-only — see procedures/admin.ts for the role check. */
export async function setUserDefaults(
  userId: string,
  defaults: UserRequestDefaultsDto,
): Promise<void> {
  await setUserRequestDefaults({ userId, ...defaults });
}

/** Admin-only — every user that has any defaults stored, for the admin settings screen. */
export async function listUserDefaults(): Promise<(UserRequestDefaultsDto & { userId: string })[]> {
  const rows = await listAllUserRequestDefaults();
  return rows.map((row) => ({
    userId: row.userId,
    radarrRootFolder: row.radarrRootFolder,
    radarrQualityProfileId: row.radarrQualityProfileId,
    sonarrRootFolder: row.sonarrRootFolder,
    sonarrQualityProfileId: row.sonarrQualityProfileId,
  }));
}

export interface RequestMovieOptions {
  /** Falls back to the requesting user's stored default if omitted. */
  rootFolderPath?: string;
  qualityProfileId?: number;
}

export class MediaRequestError extends Error {}
export class TitleNotFoundError extends MediaRequestError {}
export class AlreadyRequestedError extends MediaRequestError {}
/** Same class as e.g. "Les Évaporés" (06.09) — TMDB knows the show but
 * TheTVDB hasn't indexed it yet (usually because it hasn't aired), so
 * neither resolution path in requestSeries() can find an ID. Distinct from
 * the other MediaRequestError cases (bad input, already requested) because
 * it's genuinely worth retrying later without changing anything — see
 * unresolved-series-requests.ts. */
export class NoTvdbIdError extends MediaRequestError {}

function assertNotAlreadyRequested(title: { requestedAt: Date | null }): void {
  if (title.requestedAt) {
    throw new AlreadyRequestedError(`Title already requested at ${title.requestedAt.toISOString()}`);
  }
}

/**
 * Push a movie straight to Radarr with a specific (or per-user default) root
 * folder + quality profile — the Jellyseerr-style "Request" action.
 * Separate from and additive to the existing tracking.updateStatus flow
 * (still the plain "add to watchlist" toggle, unchanged, still backed by the
 * passive Radarr "Import List" as a fallback for anyone who never uses this).
 * Also marks the title watchlisted, same as a plain add would.
 */
export async function requestMovie(
  userId: string,
  requestedByName: string,
  titleId: string,
  options: RequestMovieOptions = {},
): Promise<void> {
  const [title] = await getTitleById(titleId);
  if (!title) throw new TitleNotFoundError(`Title not found: ${titleId}`);
  assertNotAlreadyRequested(title);

  const defaults = await getUserDefaults(userId);
  const rootFolderPath = options.rootFolderPath ?? defaults.radarrRootFolder;
  const qualityProfileId = options.qualityProfileId ?? defaults.radarrQualityProfileId;
  if (!rootFolderPath || !qualityProfileId) {
    throw new MediaRequestError(
      "No root folder / quality profile chosen and no default set for this user",
    );
  }

  await quickAddTitle(userId, titleId);
  // Tag visible directly in Radarr's own UI (24.08, Sid — "un moyen de
  // rajouter des étiquettes... avec nom utilisateur").
  await addMovie({ tmdbId: title.tmdbId, rootFolderPath, qualityProfileId, tagLabel: requestedByName });
  await markTitleRequested(titleId, userId);
}

export interface RequestSeriesOptions {
  rootFolderPath?: string;
  qualityProfileId?: number;
  /** Seer-style per-season picker — omit to request every season. */
  seasonNumbers?: number[];
}

/** Series counterpart of requestMovie — see its doc comment for the overall design. */
export async function requestSeries(
  userId: string,
  requestedByName: string,
  titleId: string,
  options: RequestSeriesOptions = {},
): Promise<void> {
  const [title] = await getTitleById(titleId);
  if (!title) throw new TitleNotFoundError(`Title not found: ${titleId}`);
  assertNotAlreadyRequested(title);

  const defaults = await getUserDefaults(userId);
  const rootFolderPath = options.rootFolderPath ?? defaults.sonarrRootFolder;
  const qualityProfileId = options.qualityProfileId ?? defaults.sonarrQualityProfileId;
  if (!rootFolderPath || !qualityProfileId) {
    throw new MediaRequestError(
      "No root folder / quality profile chosen and no default set for this user",
    );
  }

  let tvdbId = title.tvdbId;
  if (tvdbId == null) {
    // Same lazy-resolve + cache pattern as getSonarrList (lists.ts) — most
    // titles already have this cached from the passive-list path by the
    // time anyone hits "Request", but a title requested before ever being
    // listed wouldn't yet.
    try {
      const externalIds = await getTvExternalIds(title.tmdbId);
      tvdbId = externalIds.tvdb_id ?? null;
      if (tvdbId != null) await batchUpdateTvdbIds([{ titleId: title.id, tvdbId }]);
    } catch (err) {
      log.warn(`Failed to resolve TVDB ID for TMDB ${title.tmdbId}:`, err);
    }
  }
  if (tvdbId == null && title.title) {
    // 04.09, Sid — TMDB's own cross-reference can be empty even when
    // TheTVDB has the show (real case: "The One About Matthew Perry",
    // tmdbId 333533 — null tvdb_id on TMDB, found fine here). Search
    // Sonarr's own title lookup (goes straight to TheTVDB) and only trust a
    // result whose tmdbId matches ours exactly — a bare title search can
    // return unrelated shows with the same name, so no match is worse than
    // a wrong one.
    try {
      const candidates = await lookupSeriesByTitle(title.title);
      const match = candidates.find((c) => c.tmdbId === title.tmdbId);
      if (match) {
        tvdbId = match.tvdbId;
        await batchUpdateTvdbIds([{ titleId: title.id, tvdbId }]);
      }
    } catch (err) {
      log.warn(`Sonarr title-search fallback failed for "${title.title}":`, err);
    }
  }
  if (tvdbId == null) {
    // 06.09, Sid: surface this back on the Upcoming page (same principle as
    // Grimmory's "missing books") instead of just erroring out and losing
    // the attempt — she can retry once TheTVDB has caught up.
    await upsertUnresolvedSeriesRequest({
      userId,
      titleId,
      requestedByName,
      reason: `No TVDB ID available for "${title.title ?? title.id}"`,
      rootFolderPath,
      qualityProfileId,
      seasonNumbers: options.seasonNumbers ?? null,
    });
    throw new NoTvdbIdError(`No TVDB ID available for "${title.title ?? title.id}"`);
  }

  await quickAddTitle(userId, titleId);
  await addSeries({
    tvdbId,
    rootFolderPath,
    qualityProfileId,
    seasonNumbers: options.seasonNumbers,
    tagLabel: requestedByName,
  });
  await markTitleRequested(titleId, userId);
  // Cleans up a stale row if this succeeded via a normal re-request rather
  // than the dedicated Retry action (which already deletes it itself).
  await deleteUnresolvedSeriesRequest(userId, titleId);
}

/** For the "En attente TMDB" grid — see UnresolvedSeriesRequestsOutput. */
export async function listUnresolvedSeriesRequestTitles(userId: string) {
  const rows = await getUnresolvedSeriesRequestTitlesForUser(userId);
  return rows.map((row) => ({
    id: row.id,
    type: "tv" as const,
    title: row.title,
    posterPath: row.posterPath,
    posterThumbHash: row.posterThumbHash,
    firstAirDate: row.firstAirDate ?? row.releaseDate,
    voteAverage: row.voteAverage,
  }));
}

/**
 * 15.10, Sid — "la page qui recenserait toutes les demandes en attente",
 * deferred 30.08 in favor of tracking via Radarr/Sonarr tags, reopened at
 * her explicit request now that requestedAt/requestedByUserId already
 * exist on titles (added the same day for the request badges).
 */
export async function listRequestedTitles(options: {
  pendingOnly: boolean;
  page: number;
  limit: number;
}) {
  const offset = (options.page - 1) * options.limit;
  const [items, total] = await Promise.all([
    getRequestedTitles({ pendingOnly: options.pendingOnly, limit: options.limit, offset }),
    countRequestedTitles(options.pendingOnly),
  ]);
  return { items, total };
}

/**
 * 28.08, Sid — "dans quelle bibliothèque ira-t-il" for a requested-but-not-
 * available title, on the title page, same idea as the "Dispo sur Emby — X"
 * line that already shows once it's owned. Reads Radarr/Sonarr directly
 * for the real folder already assigned to this specific request rather than
 * userRequestDefaults (per-user, mutable — could've changed since the
 * request went out, or the request could've come from the passive Import
 * List / a direct Radarr/Sonarr add with no Sofa default involved at all).
 * Best-effort: any failure (not configured, unreachable, not found there
 * yet) returns null rather than surfacing an error on the title page.
 */
export async function getPendingLibraryFolder(titleId: string): Promise<string | null> {
  const [title] = await getTitleById(titleId);
  if (!title || !title.requestedAt) return null;

  try {
    if (title.type === "movie") {
      const movie = await getMovieByTmdbId(title.tmdbId);
      return movie?.rootFolderPath ?? null;
    }
    if (title.tvdbId == null) return null;
    const series = await getSeriesByTvdbId(title.tvdbId);
    return series?.rootFolderPath ?? null;
  } catch (err) {
    log.warn(`Failed to look up pending library folder for "${title.title}":`, err);
    return null;
  }
}

export interface RequestedSyncResult {
  moviesChecked: number;
  seriesChecked: number;
  backfilled: number;
}

/**
 * Reconciliation pass (24.08, Sid — real gap found: "Mutiny" requested by
 * her sister directly in Radarr showed as never-requested in Sofa) — Radarr
 * and Sonarr are the source of truth for "already requested", not just
 * Sofa's own Request button. Backfills titles.requestedAt for anything
 * already in Radarr/Sonarr that Sofa doesn't know about yet, using Radarr/
 * Sonarr's own `added` date rather than "now" (more accurate, and idempotent
 * — a later Sofa Request pushed the same day won't look like a fresh one).
 * Same cron-job shape as scanEmbyLibrary (emby-library.ts): best-effort per
 * source, one failing doesn't block the other.
 */
export async function syncRequestedFromRadarrSonarr(): Promise<RequestedSyncResult> {
  let moviesChecked = 0;
  let seriesChecked = 0;
  let backfilled = 0;
  let imported = 0;

  // 17.09, Sid: "toujours hyper long" — real evidence pinned the hourly
  // heartbeat stalls to this exact job (cron "40 * * * *" lines up with
  // logged "Event loop heartbeat delayed" spikes), but the run that
  // triggered them did 0 imported/0 backfilled, ruling out the per-title
  // insert/update loops below as the cause. Step-level timing here is to
  // find out WHICH of the two remaining steps (the Radarr/Sonarr fetch
  // itself vs. the getExistingTitlesBy*Ids lookup) actually blocks, rather
  // than guessing — same rule as the 21.08 getSession() investigation.
  let stepStart = performance.now();
  function logStep(label: string) {
    const ms = Math.round(performance.now() - stepStart);
    if (ms > 500) log.warn(`syncRequestedFromRadarrSonarr: ${label} took ${ms}ms`);
    stepStart = performance.now();
  }

  try {
    const movies = await getAllMovies();
    logStep("getAllMovies()");
    moviesChecked = movies.length;
    const existingMovieTitles = await getExistingTitlesByTmdbIds(movies.map((m) => m.tmdbId));
    const titlesByTmdbId = new Map<number, { id: string; requestedAt: Date | null }>(
      existingMovieTitles.filter((t) => t.type === "movie").map((t) => [t.tmdbId, t]),
    );
    logStep(`getExistingTitlesByTmdbIds() (${movies.length} ids)`);

    // Real gap found live (24.08, Sid): a show requested straight in Sonarr
    // that nobody had ever browsed/searched inside Sofa had no `titles` row
    // at all, so the lookup above always missed it — no amount of syncing
    // could ever backfill something Sofa didn't know existed. Import any
    // Radarr movie Sofa has never seen before doing the backfill pass.
    const unknownMovies = movies.filter((m) => !titlesByTmdbId.has(m.tmdbId));
    if (unknownMovies.length > 0) {
      const created = await ensureBrowseTitlesExist(
        unknownMovies.map((m) => ({
          tmdbId: m.tmdbId,
          type: "movie",
          title: m.title,
          posterPath: null,
        })),
      );
      for (const m of unknownMovies) {
        const entry = created.get(`${m.tmdbId}-movie`);
        if (entry) {
          titlesByTmdbId.set(m.tmdbId, { id: entry.id, requestedAt: null });
          imported++;
        }
      }
    }

    const updates: { titleId: string; at: Date }[] = [];
    for (const movie of movies) {
      const title = titlesByTmdbId.get(movie.tmdbId);
      if (title && !title.requestedAt) {
        updates.push({ titleId: title.id, at: new Date(movie.added) });
      }
    }
    if (updates.length > 0) await markTitlesRequested(updates);
    logStep(`unknown-movies import + markTitlesRequested() (${updates.length} updates)`);
    backfilled += updates.length;
  } catch (err) {
    log.warn("Radarr requested-sync failed:", err);
  }

  stepStart = performance.now();
  try {
    const series = await getAllSeries();
    logStep("getAllSeries()");
    seriesChecked = series.length;
    const existingSeriesTitles = await getExistingTitlesByTvdbIds(series.map((s) => s.tvdbId));
    const titlesByTvdbId = new Map<number, { id: string; requestedAt: Date | null }>();
    for (const t of existingSeriesTitles) {
      if (t.type === "tv" && t.tvdbId != null) titlesByTvdbId.set(t.tvdbId, t);
    }
    logStep(`getExistingTitlesByTvdbIds() (${series.length} ids)`);

    // Same gap as movies above, but series need an extra hop: Sonarr only
    // gives us a tvdbId, and Sofa keys titles by tmdbId — resolve via TMDB's
    // find-by-external-id first, then import using the tvdbId Sonarr already
    // gave us (no second TMDB round-trip needed to get it back).
    const unknownSeries = series.filter((s) => !titlesByTvdbId.has(s.tvdbId));
    for (const s of unknownSeries) {
      try {
        const tmdbId = await resolveShowTmdbId({ tvdbId: s.tvdbId, title: s.title, year: s.year });
        if (!tmdbId) continue;
        // Real bug found live (25.08, Sid — "Super Pumped" phantom duplicate):
        // TMDB's own tvdbId cross-reference data isn't always reliable
        // (tvdbId 403415 resolved to an unrelated show also happening to be
        // titled "Super Pumped"). resolveShowTmdbId trusts the external-ID
        // match blindly with no way to verify it found the right show — a
        // cheap sanity check (does the resolved show's air year land within
        // 2 years of what Sonarr reported?) catches an obviously-wrong match
        // without a full title-similarity engine.
        if (s.year) {
          try {
            const details = await getTvDetails(tmdbId);
            const resolvedYear = details.first_air_date
              ? Number(details.first_air_date.slice(0, 4))
              : null;
            if (resolvedYear && Math.abs(resolvedYear - s.year) > 2) {
              log.warn(
                `Skipping Sonarr series "${s.title}" (tvdb ${s.tvdbId}): resolved to TMDB ${tmdbId} "${details.name}" (${resolvedYear}), too far from Sonarr's year ${s.year} — likely a bad tvdbId match`,
              );
              continue;
            }
          } catch (err) {
            log.warn(`Failed to verify year for TMDB ${tmdbId} (tvdb ${s.tvdbId}):`, err);
          }
        }
        const created = await ensureBrowseTitlesExist([
          { tmdbId, type: "tv", title: s.title, posterPath: null },
        ]);
        const entry = created.get(`${tmdbId}-tv`);
        if (!entry) continue;
        await batchUpdateTvdbIds([{ titleId: entry.id, tvdbId: s.tvdbId }]);
        titlesByTvdbId.set(s.tvdbId, { id: entry.id, requestedAt: null });
        imported++;
      } catch (err) {
        log.warn(`Failed to import unknown Sonarr series "${s.title}" (tvdb ${s.tvdbId}):`, err);
      }
    }
    logStep(`unknown-series import loop (${unknownSeries.length} unknown)`);

    const updates: { titleId: string; at: Date }[] = [];
    for (const s of series) {
      const title = titlesByTvdbId.get(s.tvdbId);
      if (title && !title.requestedAt) {
        updates.push({ titleId: title.id, at: new Date(s.added) });
      }
    }
    if (updates.length > 0) await markTitlesRequested(updates);
    logStep(`markTitlesRequested() (${updates.length} updates)`);
    backfilled += updates.length;
  } catch (err) {
    log.warn("Sonarr requested-sync failed:", err);
  }

  log.info(
    `Requested sync: ${moviesChecked} movies, ${seriesChecked} series checked, ${imported} imported, ${backfilled} backfilled`,
  );
  return { moviesChecked, seriesChecked, backfilled };
}
