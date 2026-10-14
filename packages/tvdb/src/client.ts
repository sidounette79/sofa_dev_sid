import { createLogger } from "@sofa/logger";

const log = createLogger("tvdb");

const TVDB_API_BASE_URL = process.env.TVDB_API_BASE_URL || "https://api4.thetvdb.com/v4";
const TVDB_REQUEST_TIMEOUT_MS = 20_000;

function getApiKey(): string {
  const key = process.env.TVDB_API_KEY;
  if (!key) throw new Error("TVDB_API_KEY is not set");
  return key;
}

// TVDB v4 auth: the API key itself isn't sent on every request — it's
// exchanged once for a JWT via /login (valid ~1 month), cached in memory,
// and refreshed well before it could expire. A 401 on a real request forces
// one fresh login+retry in case the token was revoked/rotated server-side.
let cachedToken: { token: string; expiresAt: number } | null = null;
const TOKEN_TTL_MS = 20 * 24 * 60 * 60 * 1000;

async function login(): Promise<string> {
  const response = await fetch(`${TVDB_API_BASE_URL}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apikey: getApiKey() }),
    signal: AbortSignal.timeout(TVDB_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`TVDB login failed: HTTP ${response.status}`);
  }
  const data = (await response.json()) as { data: { token: string } };
  return data.data.token;
}

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;
  const token = await login();
  cachedToken = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function tvdbFetch<T>(path: string, retrying = false): Promise<T> {
  const token = await getToken();
  const response = await fetch(`${TVDB_API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TVDB_REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401 && !retrying) {
    cachedToken = null;
    return tvdbFetch<T>(path, true);
  }
  if (!response.ok) {
    throw new Error(`TVDB API error: HTTP ${response.status} on ${path}`);
  }
  return (await response.json()) as T;
}

export interface TvdbEpisodeTranslation {
  seasonNumber: number;
  episodeNumber: number;
  name: string | null;
  overview: string | null;
}

interface TvdbEpisodesResponse {
  data: {
    episodes: {
      seasonNumber: number;
      number: number;
      name: string | null;
      overview: string | null;
    }[];
  };
  links?: { next: string | null };
}

/**
 * Fetches a series' full episode list already localized to `lang` — TVDB's
 * per-season-type episode listing takes a language code directly, so this is
 * one (paginated) call for the whole show instead of one translation call
 * per episode. Episodes with no translation in that language come back with
 * name/overview null — callers should fall back to another source (TMDB)
 * for those, same convention as the rest of Sofa's provider fallbacks.
 */
export async function getSeriesEpisodesTranslated(
  tvdbId: number,
  lang = "fra",
): Promise<TvdbEpisodeTranslation[]> {
  const episodes: TvdbEpisodeTranslation[] = [];
  let page = 0;
  for (;;) {
    const data = await tvdbFetch<TvdbEpisodesResponse>(
      `/series/${tvdbId}/episodes/default/${lang}?page=${page}`,
    );
    for (const ep of data.data.episodes) {
      episodes.push({
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.number,
        name: ep.name,
        overview: ep.overview,
      });
    }
    if (!data.links?.next) break;
    page++;
    if (page > 50) {
      log.warn(`TVDB episode pagination exceeded 50 pages for series ${tvdbId}, stopping`);
      break;
    }
  }
  return episodes;
}

interface TvdbSeriesTranslationResponse {
  data: {
    name: string | null;
    overview: string | null;
  };
}

/**
 * Fetches the series-level name/overview translation — the show's own
 * synopsis, separate from any individual episode's. Returns nulls (not a
 * throw) when TVDB has no translation in that language for this series,
 * same "fall back silently" convention as the episode fetch.
 */
export async function getSeriesTranslation(
  tvdbId: number,
  lang = "fra",
): Promise<{ name: string | null; overview: string | null }> {
  try {
    const data = await tvdbFetch<TvdbSeriesTranslationResponse>(
      `/series/${tvdbId}/translations/${lang}`,
    );
    return { name: data.data.name, overview: data.data.overview };
  } catch (err) {
    log.warn(`No TVDB series translation for ${tvdbId}/${lang}:`, err);
    return { name: null, overview: null };
  }
}

export function isTvdbConfigured(): boolean {
  return Boolean(process.env.TVDB_API_KEY);
}
