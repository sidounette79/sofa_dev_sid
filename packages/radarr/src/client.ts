import { RADARR_API_KEY, RADARR_URL } from "@sofa/config";
import { createLogger } from "@sofa/logger";

const log = createLogger("radarr");

// Same convention as every other external client in this codebase (Prowlarr:
// 15s, TMDB: 30s, TVDB: 20s) — see the missing-timeout freeze bugs found and
// fixed 21.08 (books.ts, prowlarr/client.ts). Never call fetch() here without
// this.
const RADARR_REQUEST_TIMEOUT_MS = 15_000;

function requireConfig() {
  if (!RADARR_URL || !RADARR_API_KEY) {
    throw new Error("Radarr not configured (RADARR_URL / RADARR_API_KEY)");
  }
  return { url: RADARR_URL, apiKey: RADARR_API_KEY };
}

async function radarrFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, apiKey } = requireConfig();
  const res = await fetch(`${url}${path}`, {
    ...init,
    headers: {
      "X-Api-Key": apiKey,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    signal: AbortSignal.timeout(RADARR_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log.error("Radarr API error", { path, status: res.status, body });
    throw new Error(`Radarr API error: HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface RadarrRootFolder {
  id: number;
  path: string;
  freeSpace: number;
  accessible: boolean;
}

export interface RadarrQualityProfile {
  id: number;
  name: string;
}

/** For the watchlist-add root-folder picker (Jellyseerr-style). */
export function getRootFolders(): Promise<RadarrRootFolder[]> {
  return radarrFetch<RadarrRootFolder[]>("/api/v3/rootfolder");
}

export interface RadarrMovieSummary {
  tmdbId: number;
  title: string;
  added: string;
}

/**
 * Every movie Radarr knows about, regardless of how it got there (Sofa's
 * Request button, Radarr's own UI/wishlist, another user entirely) — for the
 * reconciliation sync (media-requests-sync.ts) that backfills Sofa's
 * "already requested" badge for requests made outside Sofa. Real gap found
 * 24.08 (Sid): a movie requested by her sister directly in Radarr showed as
 * never-requested in Sofa.
 */
export async function getAllMovies(): Promise<RadarrMovieSummary[]> {
  return radarrFetch<RadarrMovieSummary[]>("/api/v3/movie");
}

export function getQualityProfiles(): Promise<RadarrQualityProfile[]> {
  return radarrFetch<RadarrQualityProfile[]>("/api/v3/qualityprofile");
}

/**
 * 28.08, Sid — "dans quelle bibliothèque ira-t-il" for a requested-but-not-
 * available movie, same as the existing "Dispo sur Emby — X" line but for
 * the pending case. Reads Radarr's own `rootFolderPath` for the real,
 * already-assigned request instead of guessing from userRequestDefaults
 * (which can drift — defaults are per-user and mutable, this is the actual
 * value Radarr committed to at request time). `/api/v3/movie?tmdbId=` is
 * Radarr's documented filter for looking up one movie by TMDB ID (same verb
 * Overseerr/Jellyseerr use for this).
 */
export async function getMovieByTmdbId(tmdbId: number): Promise<{ rootFolderPath: string } | null> {
  const results = await radarrFetch<{ rootFolderPath: string }[]>(
    `/api/v3/movie?tmdbId=${tmdbId}`,
  );
  return results[0] ?? null;
}

// Subset of Radarr's movie-lookup response actually needed to build the
// addMovie() request body below — Radarr requires most of this object back
// verbatim (title, images, etc.), not just the tmdbId.
export interface RadarrMovieLookup {
  title: string;
  tmdbId: number;
  year: number;
  images: unknown[];
  titleSlug: string;
  [key: string]: unknown;
}

/**
 * Resolve a TMDB ID to the full object Radarr needs for addMovie(). Real bug
 * found live (24.08, Sofa logs): unlike the generic `/movie/lookup?term=...`
 * endpoint (array), this tmdb-specific endpoint returns a single object, not
 * an array — confirmed with a direct curl against this NAS's real Radarr.
 * `results[0]` on that object was always undefined, so every request failed.
 */
export async function lookupMovieByTmdbId(tmdbId: number): Promise<RadarrMovieLookup | null> {
  const result = await radarrFetch<RadarrMovieLookup | Record<string, never>>(
    `/api/v3/movie/lookup/tmdb?tmdbId=${tmdbId}`,
  );
  return "tmdbId" in result ? (result as RadarrMovieLookup) : null;
}

export interface AddMovieOptions {
  tmdbId: number;
  rootFolderPath: string;
  qualityProfileId: number;
  /** Trigger Radarr's own indexer search immediately, don't wait for its next cycle. */
  searchNow?: boolean;
  /** Radarr tag label (e.g. the requesting user's name) — created if it doesn't exist yet. */
  tagLabel?: string;
}

interface RadarrTag {
  id: number;
  label: string;
}

/**
 * Radarr tags are label -> numeric id, and there's no "get or create" verb —
 * find the existing tag by label (case-insensitive, same as Radarr's own
 * matching) or create it. Used for the "who requested this" tag (24.08, Sid
 * — "un moyen de rajouter des étiquettes... simplement avec nom
 * utilisateur"), visible directly in Radarr's own UI.
 */
async function getOrCreateTag(label: string): Promise<number> {
  const existing = await radarrFetch<RadarrTag[]>("/api/v3/tag");
  const match = existing.find((t) => t.label.toLowerCase() === label.toLowerCase());
  if (match) return match.id;

  const created = await radarrFetch<RadarrTag>("/api/v3/tag", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
  return created.id;
}

/**
 * Add a movie to Radarr with a per-request root folder + quality profile,
 * monitored and (by default) searched immediately — mirrors what Jellyseerr
 * does at request time. Distinct from the existing passive "Import List"
 * integration (see apps/server/src/routes/lists.ts): that one is Radarr
 * pulling from Sofa on its own schedule with one fixed folder/profile for
 * everything; this is Sofa pushing a single request with a folder/profile
 * chosen at the moment of the request.
 */
export async function addMovie(options: AddMovieOptions): Promise<void> {
  const movie = await lookupMovieByTmdbId(options.tmdbId);
  if (!movie) {
    throw new Error(`Radarr lookup found no movie for tmdbId ${options.tmdbId}`);
  }

  const tagId = options.tagLabel ? await getOrCreateTag(options.tagLabel) : null;

  await radarrFetch("/api/v3/movie", {
    method: "POST",
    body: JSON.stringify({
      ...movie,
      qualityProfileId: options.qualityProfileId,
      rootFolderPath: options.rootFolderPath,
      monitored: true,
      addOptions: { searchForMovie: options.searchNow ?? true },
      tags: tagId != null ? [tagId] : [],
    }),
  });
}
