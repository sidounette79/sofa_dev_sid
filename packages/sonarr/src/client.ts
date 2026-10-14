import { SONARR_API_KEY, SONARR_URL } from "@sofa/config";
import { createLogger } from "@sofa/logger";

const log = createLogger("sonarr");

// Same convention as every other external client in this codebase (Prowlarr:
// 15s, TMDB: 30s, TVDB: 20s) — see the missing-timeout freeze bugs found and
// fixed 21.08 (books.ts, prowlarr/client.ts). Never call fetch() here without
// this.
const SONARR_REQUEST_TIMEOUT_MS = 15_000;

function requireConfig() {
  if (!SONARR_URL || !SONARR_API_KEY) {
    throw new Error("Sonarr not configured (SONARR_URL / SONARR_API_KEY)");
  }
  return { url: SONARR_URL, apiKey: SONARR_API_KEY };
}

async function sonarrFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, apiKey } = requireConfig();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": apiKey,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(SONARR_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log.error("Sonarr API error", { path, status: res.status, body });
    throw new Error(`Sonarr API error: HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface SonarrRootFolder {
  id: number;
  path: string;
  freeSpace: number;
  accessible: boolean;
}

export interface SonarrQualityProfile {
  id: number;
  name: string;
}

/** For the watchlist-add root-folder picker (Jellyseerr-style). */
export function getRootFolders(): Promise<SonarrRootFolder[]> {
  return sonarrFetch<SonarrRootFolder[]>("/api/v3/rootfolder");
}

export function getQualityProfiles(): Promise<SonarrQualityProfile[]> {
  return sonarrFetch<SonarrQualityProfile[]>("/api/v3/qualityprofile");
}

/** Series counterpart of Radarr's getMovieByTmdbId — see its own doc comment. */
export async function getSeriesByTvdbId(tvdbId: number): Promise<{ rootFolderPath: string } | null> {
  const results = await sonarrFetch<{ rootFolderPath: string }[]>(
    `/api/v3/series?tvdbId=${tvdbId}`,
  );
  return results[0] ?? null;
}

export interface SonarrSeriesSummary {
  tvdbId: number;
  title: string;
  year: number;
  added: string;
}

/** Every series Sonarr knows about — see getAllMovies (radarr/client.ts) for why. */
export async function getAllSeries(): Promise<SonarrSeriesSummary[]> {
  return sonarrFetch<SonarrSeriesSummary[]>("/api/v3/series");
}

// Subset of Sonarr's series-lookup response actually needed to build the
// addSeries() request body below — Sonarr requires most of this object back
// verbatim (title, images, seasons, etc.), not just the tvdbId.
export interface SonarrSeason {
  seasonNumber: number;
  monitored: boolean;
  [key: string]: unknown;
}

export interface SonarrSeriesLookup {
  title: string;
  tvdbId: number;
  /** Present on Sonarr v4+ lookup results — used to confirm a title-search match is the right show. */
  tmdbId?: number;
  year: number;
  images: unknown[];
  seasons: SonarrSeason[];
  titleSlug: string;
  [key: string]: unknown;
}

/** Resolve a TVDB ID to the full object Sonarr needs for addSeries(). */
export async function lookupSeriesByTvdbId(tvdbId: number): Promise<SonarrSeriesLookup | null> {
  const results = await sonarrFetch<SonarrSeriesLookup[]>(
    `/api/v3/series/lookup?term=tvdb:${tvdbId}`,
  );
  return results[0] ?? null;
}

/**
 * 04.09, Sid — real case: TMDB's own external_ids for a title can come back
 * with no tvdb_id even when TheTVDB *does* have the show (their two DBs are
 * separately maintained; the cross-reference just hasn't been filled in on
 * TMDB's side yet). Sonarr's own title search goes straight to TheTVDB and
 * isn't affected by that gap — confirmed live: "The One About Matthew Perry"
 * (tmdbId 333533) had a null tvdb_id on TMDB, but this lookup found it
 * (tvdbId 482057) with the matching tmdbId right there in the result. This
 * is the same path Jellyseerr uses, which is why it could request the show
 * when Sofa's TMDB-only resolution couldn't. Returns every candidate — the
 * caller must confirm the right one (e.g. by tmdbId) before trusting it,
 * since a plain title search can return unrelated shows with similar names.
 */
export async function lookupSeriesByTitle(title: string): Promise<SonarrSeriesLookup[]> {
  return sonarrFetch<SonarrSeriesLookup[]>(
    `/api/v3/series/lookup?term=${encodeURIComponent(title)}`,
  );
}

export interface AddSeriesOptions {
  tvdbId: number;
  rootFolderPath: string;
  qualityProfileId: number;
  /** Trigger Sonarr's own indexer search immediately, don't wait for its next cycle. */
  searchNow?: boolean;
  /**
   * Seer-style per-season picker (22.08, Sid — "pas retélécharger une saison
   * déjà vue il y a longtemps"): season numbers to actually monitor/download.
   * Omit to monitor every season (the previous, all-or-nothing behavior).
   */
  seasonNumbers?: number[];
  /** Sonarr tag label (e.g. the requesting user's name) — created if it doesn't exist yet. */
  tagLabel?: string;
}

interface SonarrTag {
  id: number;
  label: string;
}

/** Same "get or create" reasoning as Radarr's getOrCreateTag — see its doc comment. */
async function getOrCreateTag(label: string): Promise<number> {
  const existing = await sonarrFetch<SonarrTag[]>("/api/v3/tag");
  const match = existing.find((t) => t.label.toLowerCase() === label.toLowerCase());
  if (match) return match.id;

  const created = await sonarrFetch<SonarrTag>("/api/v3/tag", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
  return created.id;
}

/**
 * Add a series to Sonarr with a per-request root folder + quality profile,
 * monitored and (by default) searched immediately — mirrors what Jellyseerr
 * does at request time. Distinct from the existing passive "Import List"
 * integration (see apps/server/src/routes/lists.ts): that one is Sonarr
 * pulling from Sofa on its own schedule with one fixed folder/profile for
 * everything; this is Sofa pushing a single request with a folder/profile
 * chosen at the moment of the request.
 *
 * NOT yet live-tested against this NAS's actual Sonarr version — the request
 * body shape (in particular whether `languageProfileId` is required) can
 * differ between Sonarr v3 and v4. Verify with a real add before relying on
 * this in production.
 */
export async function addSeries(options: AddSeriesOptions): Promise<void> {
  const series = await lookupSeriesByTvdbId(options.tvdbId);
  if (!series) {
    throw new Error(`Sonarr lookup found no series for tvdbId ${options.tvdbId}`);
  }

  // Per-season monitoring: only meaningful when the caller passed an
  // explicit subset — otherwise leave Sonarr's own lookup defaults alone
  // (every season monitored), same as before this option existed.
  const seasons = options.seasonNumbers
    ? series.seasons.map((s) => ({
        ...s,
        monitored: options.seasonNumbers!.includes(s.seasonNumber),
      }))
    : series.seasons;

  const tagId = options.tagLabel ? await getOrCreateTag(options.tagLabel) : null;

  await sonarrFetch("/api/v3/series", {
    method: "POST",
    body: JSON.stringify({
      ...series,
      seasons,
      tags: tagId != null ? [tagId] : [],
      qualityProfileId: options.qualityProfileId,
      rootFolderPath: options.rootFolderPath,
      monitored: true,
      seasonFolder: true,
      addOptions: { searchForMissingEpisodes: options.searchNow ?? true },
    }),
  });
}
