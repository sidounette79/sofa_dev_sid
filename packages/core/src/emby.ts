import { EMBY_API_KEY, EMBY_PUBLIC_URL, EMBY_URL } from "@sofa/config";
import { createLogger } from "@sofa/logger";

import { resolveMovieTmdbId, resolveShowTmdbId } from "./imports/resolve";

const log = createLogger("emby-now-playing");

interface EmbySessionRaw {
  Id: string;
  UserId?: string;
  UserName?: string;
  NowPlayingItem?: {
    Id: string;
    Name: string;
    Type: string;
    RunTimeTicks?: number;
    ProviderIds?: Record<string, string>;
    SeriesId?: string;
    SeriesName?: string;
    ParentIndexNumber?: number;
    IndexNumber?: number;
  };
  PlayState?: {
    PositionTicks?: number;
    IsPaused?: boolean;
  };
}

// In-memory cache for the process: Emby SeriesId -> tmdbId (avoids one API call per poll)
const seriesTmdbCache = new Map<string, number | null>();
// 30.09, Sid — found live: her wife's iPhone session was playing an episode
// whose Emby ProviderIds carry no Tmdb id, only Imdb/Tvdb - resolveShowTmdbId
// (below) tries IMDB then TVDB against TMDB's /find, each gated by
// tmdbLimiter with no per-call timeout of its own. Every nowPlaying poll
// that lands before the first lookup finishes and populates the cache
// starts its OWN full resolution instead of waiting on it - overlapping
// polls (the dashboard's own 7s refresh, or just her reloading) stacked
// their calls on the same rate limiter, and each new wave measured live
// slower than the last: 12s, then 14s x2, then 32s, then 42s x3. Same
// class of fix as getSessionCoalesced (orpc/middleware.ts) - concurrent
// callers for the same seriesId now share one in-flight resolution
// instead of each starting their own.
const seriesTmdbInFlight = new Map<string, Promise<number | null>>();

// 21.08: the actual dominant root cause of tonight's recurring multi-minute
// full-server freeze — this is the ONE function every Emby-related call in
// the app goes through (library ownership checks, continueWatching,
// nowPlaying polling every 7s from the dashboard, getEmbyServerId on every
// title view), and it had no timeout, unlike TMDB (30s) and TVDB (20s).
// Confirmed via an in-process event-loop heartbeat that the whole server
// was genuinely stalled (not just this call) for as long as 250s in one
// case — consistent with Emby occasionally being slow/overloaded (e.g.
// during active transcoding) with nothing here to bound the wait. A
// similar missing-timeout bug in book-related clients (Wikipedia,
// OpenLibrary, Hardcover, Prowlarr, Readarr) was fixed earlier tonight but
// didn't fully explain the pattern — this one, used on nearly every page,
// does.
const EMBY_REQUEST_TIMEOUT_MS = 15_000;

export async function embyFetch<T>(path: string): Promise<T> {
  if (!EMBY_URL || !EMBY_API_KEY) {
    throw new Error("Emby is not configured");
  }
  const res = await fetch(`${EMBY_URL}${path}`, {
    headers: { "X-Emby-Token": EMBY_API_KEY },
    signal: AbortSignal.timeout(EMBY_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Emby API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

// 08.10, Sid ("ça bloque TOUT le temps... entre 25 secondes et 1 minute"):
// confirmed live - embyFetch's AbortSignal.timeout(15s) AND the 5s
// application-level Promise.race in fetchEmbySessions() below BOTH failed
// to protect the page (freeze measured at 73s). The giveaway: the whole
// event-loop heartbeat was delayed by the SAME ~73s - if the thread were
// just waiting on an ordinary pending promise, the heartbeat's own
// unrelated setTimeout would still have fired on schedule. A real
// comparison confirmed it's Bun-specific, not Emby/network/Sofa's own
// code: Poupistats (Tracearr) polls this exact same Emby /Sessions
// endpoint, same AbortSignal.timeout() pattern, on Node.js instead of Bun
// - and never freezes. Matches a known, open Bun bug: fetch() can hang
// while reading the response BODY even after headers already arrived,
// in a way regular/even application-level timeouts don't reliably
// interrupt (github.com/Marco-Cricchio/moh/issues/922,
// github.com/oven-sh/bun#29546).
//
// Bypasses Bun's native fetch entirely for this one hot, frequently-polled
// path (dashboard now-playing, every 7s) - curl as a real OS subprocess,
// whose own --max-time is enforced by curl's own C code / OS timer,
// independent of whatever Bun's JS event loop is doing. Everything else
// in this file keeps using embyFetch() unchanged - this is a targeted
// workaround for the one call that's actually proven to hang, not a
// blanket rewrite.
async function embyFetchViaCurl<T>(path: string, timeoutS = 20): Promise<T> {
  if (!EMBY_URL || !EMBY_API_KEY) {
    throw new Error("Emby is not configured");
  }
  const url = `${EMBY_URL}${path}`;
  const proc = Bun.spawn(
    ["curl", "-sS", "--max-time", String(timeoutS), "-H", `X-Emby-Token: ${EMBY_API_KEY}`, url],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Emby API error via curl (exit ${exitCode}): ${stderr.trim() || "no output"}`);
  }
  return JSON.parse(stdout) as T;
}

/** POST variant — remote-control endpoints (e.g. telling another session
 * to start playing something) take no response body worth parsing. */
export async function embyPost(path: string): Promise<void> {
  if (!EMBY_URL || !EMBY_API_KEY) {
    throw new Error("Emby is not configured");
  }
  const res = await fetch(`${EMBY_URL}${path}`, {
    method: "POST",
    headers: { "X-Emby-Token": EMBY_API_KEY },
    signal: AbortSignal.timeout(EMBY_REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Emby API error: ${res.status} ${res.statusText}`);
  }
}

/** Every Emby user, keyed by lowercased username — resolves a Sofa
 * integration's stored `embyUsername` to the actual Emby user ID needed by
 * every per-user Emby API call (Sessions/Devices filtering, reconciliation).
 * Shared by emby-watch-reconciliation.ts and playback-devices.ts instead of
 * each fetching /Users on its own. */
export async function getEmbyUserIdsByUsername(): Promise<Map<string, string>> {
  const users = await embyFetch<{ Id: string; Name: string }[]>("/Users");
  return new Map(users.map((u) => [u.Name.toLowerCase(), u.Id] as const));
}

// 25.08, Sid: Sofa only ever sourced posters from TMDB, even for titles it
// already knows are physically in her Emby library — TMDB simply doesn't
// have artwork for some niche/French content she owns (confirmed: 10 of her
// tracked titles have posterPath === null, several of them inEmbyLibrary).
// Emby's own metadata agents (TheTVDB, fanart.tv, local NFO) often have art
// TMDB never got. Binary, not JSON, so this can't reuse embyFetch — same
// timeout discipline as that function for the same reason (21.08 freeze).
/** Prefer TMDB's poster; fall back to Emby's own artwork for titles TMDB has no image for. */
export function resolvePosterUrl(
  tmdbUrl: string | null,
  embyItemId: string | null | undefined,
): string | null {
  if (tmdbUrl) return tmdbUrl;
  if (embyItemId) return `/emby-images/${embyItemId}`;
  return null;
}

export async function fetchEmbyImage(
  embyItemId: string,
): Promise<{ buffer: ArrayBuffer; contentType: string } | null> {
  if (!EMBY_URL || !EMBY_API_KEY) return null;
  try {
    const res = await fetch(`${EMBY_URL}/Items/${embyItemId}/Images/Primary`, {
      headers: { "X-Emby-Token": EMBY_API_KEY },
      signal: AbortSignal.timeout(EMBY_REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/jpeg";
    const buffer = await res.arrayBuffer();
    return { buffer, contentType };
  } catch {
    return null;
  }
}

async function resolveSeriesTmdbId(
  seriesId: string,
  seriesName: string | undefined,
  requestingUserId: string | undefined,
): Promise<number | null> {
  if (seriesTmdbCache.has(seriesId)) {
    return seriesTmdbCache.get(seriesId) ?? null;
  }

  const existing = seriesTmdbInFlight.get(seriesId);
  if (existing) return existing;

  const resolution = (async () => {
    if (!requestingUserId) return null;
    try {
      // Emby requires the /Users/{userId}/Items/{id} path — the bare
      // /Items/{id} path returns 404 even with a valid API key.
      const item = await embyFetch<{ ProviderIds?: Record<string, string> }>(
        `/Users/${requestingUserId}/Items/${seriesId}?Fields=ProviderIds`,
      );
      const providerIds = item.ProviderIds ?? {};
      const tmdbId = providerIds.Tmdb
        ? Number(providerIds.Tmdb)
        : await resolveShowTmdbId({
            tvdbId: providerIds.Tvdb,
            imdbId: providerIds.Imdb,
            title: seriesName,
          });
      seriesTmdbCache.set(seriesId, tmdbId ?? null);
      return tmdbId ?? null;
    } catch {
      // Don't cache on failure — a transient error shouldn't permanently
      // block resolution for this series on future polls.
      return null;
    }
  })();

  seriesTmdbInFlight.set(seriesId, resolution);
  try {
    return await resolution;
  } finally {
    seriesTmdbInFlight.delete(seriesId);
  }
}

let cachedServerId: string | null = null;

/** Emby's unique server ID, used for deep-linking (emby://items?serverId=...&itemId=...). */
export async function getEmbyServerId(): Promise<string | null> {
  if (cachedServerId) return cachedServerId;
  try {
    const info = await embyFetch<{ Id?: string }>("/System/Info");
    cachedServerId = info.Id ?? null;
    return cachedServerId;
  } catch {
    return null;
  }
}

/** Public Emby URL for web fallback deep-linking (app deep-links are unreliable on iOS/Android). */
export function getEmbyPublicUrl(): string | null {
  return EMBY_PUBLIC_URL;
}

export interface EmbyNowPlayingSession {
  sessionId: string;
  userName: string | null;
  type: "movie" | "tv";
  tmdbId: number | null;
  seriesName: string | null;
  episodeName: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progressPercent: number;
  isPaused: boolean;
}

// 30.09, Sid — Moonbase only syncs settings it natively recognizes and
// silently drops Moonfin's own custom ones (confirmed by hand: pushed to
// Global from her phone, pulled on TV, nothing arrived). This is Moonfin's
// own settings-sync channel through Sofa instead, authenticated by
// delegating to Emby itself: Moonfin already holds a valid Emby access
// token for the logged-in user (it needs one for every other call it
// makes), so it's handed straight to Emby's own /Users/Me rather than
// inventing a separate secret Sofa would have to mint, expose in some UI,
// and Sid would have to copy into Moonfin by hand.
export async function verifyEmbyUserToken(token: string): Promise<string | null> {
  if (!EMBY_URL || !token) return null;
  try {
    const response = await fetch(`${EMBY_URL}/Users/Me`, {
      headers: { "X-Emby-Token": token },
      signal: AbortSignal.timeout(EMBY_REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const user = (await response.json()) as { Id?: string };
    return user.Id ?? null;
  } catch {
    return null;
  }
}

// 30.09, Sid: instrumented and measured live - the dominant, wildly
// variable cost is Emby's own /Sessions response time itself (1.7s one
// poll, 40-59s another, same endpoint, same query), not anything in this
// codebase - direct curl from this NAS to Emby measured 16ms at the same
// time, so it's not raw network latency either, something server-side on
// Emby (2 concurrent playback sessions at the time). Not fixable here at
// the root, so cushioning it instead: an in-flight dedup (overlapping
// polls - the dashboard's own 7s refresh, several page loads - share one
// call instead of each waiting on Emby independently) plus a short-lived
// cache so a burst of polls within a couple seconds doesn't hit Emby
// again while it's already slow.
let sessionsCache: { data: EmbySessionRaw[]; at: number } | null = null;
let sessionsInFlight: Promise<EmbySessionRaw[]> | null = null;
const SESSIONS_CACHE_TTL_MS = 2_000;

// 30.09, Sid: measured live - embyFetch's own AbortSignal.timeout(15s)
// did NOT actually cut this request off; it ran 66.7s once, 4x+ over its
// configured timeout. Whatever's happening Emby-side, Bun's fetch here
// isn't reliably honoring the abort once headers are pending, so a
// second, application-level race is added on top: this caller gives up
// after 5s and returns an empty list (a temporarily-blank "now playing"
// card beats freezing the whole page). The real embyFetch call is left
// running in the background - sessionsInFlight isn't touched by the
// race - so if Emby does eventually answer, it still fills the cache for
// the next poll instead of being wasted.
const APPLICATION_TIMEOUT_MS = 5_000;

async function fetchEmbySessions(): Promise<EmbySessionRaw[]> {
  if (sessionsCache && Date.now() - sessionsCache.at < SESSIONS_CACHE_TTL_MS) {
    return sessionsCache.data;
  }
  if (!sessionsInFlight) {
    const fetchStart = performance.now();
    sessionsInFlight = embyFetchViaCurl<EmbySessionRaw[]>("/Sessions?ActiveWithinSeconds=960")
      .then((data) => {
        const fetchMs = Math.round(performance.now() - fetchStart);
        if (fetchMs > 500) log.warn(`getEmbyNowPlaying: /Sessions fetch took ${fetchMs}ms`);
        sessionsCache = { data, at: Date.now() };
        return data;
      })
      .finally(() => {
        sessionsInFlight = null;
      });
  }

  const inFlight = sessionsInFlight;
  try {
    return await Promise.race([
      inFlight,
      new Promise<EmbySessionRaw[]>((_, reject) => {
        setTimeout(() => reject(new Error("Emby /Sessions timed out (app-level)")), APPLICATION_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return [];
  }
}

export async function getEmbyNowPlaying(): Promise<EmbyNowPlayingSession[]> {
  if (!EMBY_URL || !EMBY_API_KEY) return [];

  let sessions: EmbySessionRaw[];
  try {
    sessions = await fetchEmbySessions();
  } catch {
    return [];
  }

  const active = sessions.filter((s) => s.NowPlayingItem);
  const results: EmbyNowPlayingSession[] = [];

  for (const s of active) {
    const loopStepStart = performance.now();
    const item = s.NowPlayingItem!;
    const positionTicks = s.PlayState?.PositionTicks ?? 0;
    const runTimeTicks = item.RunTimeTicks ?? 0;
    const progressPercent =
      runTimeTicks > 0 ? Math.min(100, Math.round((positionTicks / runTimeTicks) * 100)) : 0;

    if (item.Type === "Movie") {
      const providerIds = item.ProviderIds ?? {};
      const tmdbId = providerIds.Tmdb
        ? Number(providerIds.Tmdb)
        : await resolveMovieTmdbId({
            tvdbId: providerIds.Tvdb,
            imdbId: providerIds.Imdb,
            title: item.Name,
          });
      results.push({
        sessionId: s.Id,
        userName: s.UserName ?? null,
        type: "movie",
        tmdbId: tmdbId ?? null,
        seriesName: null,
        episodeName: item.Name,
        seasonNumber: null,
        episodeNumber: null,
        progressPercent,
        isPaused: s.PlayState?.IsPaused ?? false,
      });
    } else if (item.Type === "Episode") {
      const tmdbId = item.SeriesId
        ? await resolveSeriesTmdbId(item.SeriesId, item.SeriesName, s.UserId)
        : null;
      results.push({
        sessionId: s.Id,
        userName: s.UserName ?? null,
        type: "tv",
        tmdbId: tmdbId ?? null,
        seriesName: item.SeriesName ?? null,
        episodeName: item.Name,
        seasonNumber: item.ParentIndexNumber ?? null,
        episodeNumber: item.IndexNumber ?? null,
        progressPercent,
        isPaused: s.PlayState?.IsPaused ?? false,
      });
    }
    const loopStepMs = Math.round(performance.now() - loopStepStart);
    if (loopStepMs > 500) {
      log.warn(
        `getEmbyNowPlaying: resolving session ${s.Id} (${s.NowPlayingItem?.Type}, "${s.NowPlayingItem?.Name}") took ${loopStepMs}ms`,
      );
    }
  }

  return results;
}
