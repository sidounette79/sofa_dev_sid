// 28.09, Sid: "attaque les modifs nécessaires côté Sofa pour qu'on puisse
// lier Moonfin/Moonbase à Sofa au lieu de Jellyseerr." Full audit of what
// Moonfin's client actually calls is in Claude's memory
// (project_moonfin_fork_punchlist.md, item 8) - every route below mirrors
// that exact list. Mounted at /api/jellyseerr in index.ts, deliberately
// NOT at /api/v1 (Sofa's own oRPC OpenAPI bridge already owns that prefix)
// - whatever full URL this ends up at (e.g.
// https://sofa.sidounette.ch/api/jellyseerr) is what needs to go into
// Moonbase's admin "Seerr URL" setting.
//
// First real pass, written without a way to run/test this locally (Sid's
// bun test env here is broken - see project_sofa_media_requests memory) -
// verified with `tsc --noEmit` only. Expect some of this to need fixing
// against real traffic, especially the exact response shapes Jellyseerr
// clients (Moonfin included) expect field-for-field.

import { type Context, Hono } from "hono";

import { auth } from "@sofa/auth/server";
import {
  AlreadyRequestedError,
  getRequestOptions,
  MediaRequestError,
  NoTvdbIdError,
  requestMovie as requestMovieFn,
  requestSeries as requestSeriesFn,
  TitleNotFoundError,
} from "@sofa/core/media-requests";
import { ensureBrowseTitlesExist } from "@sofa/core/metadata";
import { getInstanceId } from "@sofa/core/settings";
import { removeTitleStatus, setTitleStatus } from "@sofa/core/tracking";
import { getExistingTitlesByTmdbIds } from "@sofa/db/queries/title";
import { getTitlesByUserStatus } from "@sofa/db/queries/tracking";
import { createLogger } from "@sofa/logger";
import {
  discover as discoverTmdb,
  findByExternalId,
  getGenres,
  getMovieDetails,
  getPersonCombinedCredits,
  getPersonDetails,
  getPopular,
  getRecommendations,
  getSimilar,
  getTrending,
  getTvDetails,
  getTvExternalIds,
  getUpcomingMovies,
  searchMulti,
  tmdbImageUrl,
} from "@sofa/tmdb/client";
import { isTmdbConfigured } from "@sofa/tmdb/config";

type CompatUser = { id: string; name: string; email?: string };
type CompatEnv = { Variables: { user: CompatUser } };

const log = createLogger("jellyseerr-compat");
const app = new Hono<CompatEnv>();

// 28.09: real Jellyseerr user ids are always a plain auto-increment
// integer, never a UUID - Moonbase's Dart client almost certainly
// deserializes the login response into a typed model expecting `id: int`,
// which throws on a UUID string (matching the generic "An unexpected
// error occurred" Sid saw right after a login that otherwise looked
// successful server-side). Sofa's own user ids are UUIDs and nothing here
// ever routes back into Sofa by this exposed integer - it only needs to
// be stable and int-shaped, not globally unique across other tables, so a
// deterministic hash of the real UUID is enough.
function compatIntId(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    hash = (hash * 31 + uuid.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

// ─── Auth ─────────────────────────────────────────────────────

async function requireUser(c: Context<CompatEnv>): Promise<CompatUser | null> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) return null;
  return session.user;
}

// 28.09: real isolated test (throwaway account, cleaned up immediately)
// confirmed better-auth DOES set a valid session cookie on sign-in - but
// named `__Secure-better-auth.session_token`, not `connect.sid`. Real
// Jellyseerr runs on Express's default session middleware, whose cookie is
// always named `connect.sid` - Moonbase's own client almost certainly
// checks for that exact name to decide "did Seerr give me a session"
// (its error was literally "No session cookie received from Seerr", not a
// network/auth failure). Mirroring the real token under that second cookie
// name costs nothing (every other endpoint here still authenticates off
// the real better-auth cookie via auth.api.getSession) and needs no
// guessing at Moonbase's closed-source logic beyond the cookie name itself.
function mirrorSessionCookies(c: Context<CompatEnv>, cookies: string[]) {
  for (const cookie of cookies) c.header("set-cookie", cookie, { append: true });
  const tokenCookie = cookies.find((raw) => raw.split(";")[0]?.includes("session_token"));
  if (!tokenCookie) return;
  const nameValue = tokenCookie.split(";")[0] ?? "";
  const eqIdx = nameValue.indexOf("=");
  if (eqIdx < 0) return;
  const value = nameValue.slice(eqIdx + 1);
  const attrs = tokenCookie.split(";").slice(1).join(";");
  c.header("set-cookie", `connect.sid=${value};${attrs}`, { append: true });
}

app.use("*", async (c, next) => {
  // /status, /settings/public and /auth/local deliberately stay open below
  // (Jellyseerr's own status endpoint doesn't require a session either -
  // Moonbase/Moonfin both probe it before login; /auth/local IS the login
  // call itself, see below - 28.09, real Emby log evidence: Moonbase's own
  // POST /Moonfin/Seerr/Login was reaching this middleware and getting
  // rejected 401 before a session could ever be created, since nothing let
  // the login request itself through).
  if (
    c.req.path.endsWith("/status") ||
    c.req.path.endsWith("/settings/public") ||
    c.req.path.endsWith("/auth/local") ||
    c.req.path.endsWith("/auth/jellyfin")
  ) {
    return next();
  }
  const user = await requireUser(c);
  if (!user) {
    log.warn(`gate rejected: ${c.req.method} ${c.req.path}`);
    return c.json({ message: "Unauthorized" }, 401);
  }
  c.set("user", user);
  return next();
});

// ─── Status / settings ───────────────────────────────────────

app.get("/status", async (c) => {
  return c.json({
    version: "1.0.0",
    commitTag: await getInstanceId(),
    updateAvailable: false,
    commitsBehind: 0,
  });
});

app.get("/settings/public", (c) => {
  return c.json({
    initialized: true,
    applicationTitle: "Patoune TV",
    // 08.10, real bug found while doing unrelated cleanup: this was reading
    // PUBLIC_API_URL, which is Sofa's own centralized update-check service
    // URL (defaults to https://public-api.sofa.watch) - completely
    // unrelated to this instance's own address. BETTER_AUTH_URL is what's
    // actually configured to this instance's real public URL.
    applicationUrl: process.env.BETTER_AUTH_URL ?? "",
    movie4kEnabled: false,
    series4kEnabled: false,
    localLogin: true,
  });
});

// 28.09, real Emby log evidence: Moonbase logs Sid's user in against the
// configured Seerr URL by POSTing here with her Seerr account's
// email+password (stored from the old Jellyseerr link, unchanged since it's
// the same email as her Sofa account) - expects a session cookie back that
// it then replays on every subsequent /Api/* call, same as a normal browser
// would. Sofa's own login already exists as better-auth's
// /api/auth/sign-in/email (see routes/auth.ts, a thin passthrough to
// auth.handler) - reused directly instead of re-implementing password
// verification here.
app.post("/auth/local", async (c) => {
  const body = await c.req.json<{ email: string; password: string }>().catch(() => null);
  if (!body?.email || !body.password) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  try {
    const result = await auth.api.signInEmail({
      body: { email: body.email, password: body.password },
      asResponse: true,
      headers: c.req.raw.headers,
    });
    if (!result.ok) {
      log.warn(`auth/local: signInEmail rejected, status=${result.status}`);
      return c.json({ message: "Unauthorized" }, 401);
    }
    mirrorSessionCookies(c, result.headers.getSetCookie?.() ?? []);
    const session = (await result.json().catch(() => null)) as { user?: CompatUser } | null;
    const user = session?.user;
    return c.json({
      id: compatIntId(user?.id ?? body.email),
      email: user?.email ?? body.email,
      displayName: user?.name ?? "",
      username: user?.name ?? "",
      permissions: 2,
    });
  } catch (err) {
    log.warn("auth/local sign-in failed:", err);
    return c.json({ message: "Unauthorized" }, 401);
  }
});

// 28.09: real Jellyseerr's own Jellyfin/Emby-login endpoint name/shape -
// Moonbase calls this, not /auth/local, mounted under /api/v1 (see
// index.ts). Body is {username, password, email?}.
app.post("/auth/jellyfin", async (c) => {
  const body = await c
    .req.json<{ username?: string; email?: string; password: string }>()
    .catch(() => null);
  const email = body?.email ?? body?.username;
  if (!email || !body?.password) {
    return c.json({ message: "Unauthorized" }, 401);
  }
  try {
    const result = await auth.api.signInEmail({
      body: { email, password: body.password },
      asResponse: true,
      headers: c.req.raw.headers,
    });
    if (!result.ok) {
      log.warn(`auth/jellyfin: signInEmail rejected, status=${result.status}`);
      return c.json({ message: "Unauthorized" }, 401);
    }
    mirrorSessionCookies(c, result.headers.getSetCookie?.() ?? []);
    const session = (await result.json().catch(() => null)) as { user?: CompatUser } | null;
    const user = session?.user;
    return c.json({
      id: compatIntId(user?.id ?? email),
      email: user?.email ?? email,
      displayName: user?.name ?? "",
      username: user?.name ?? "",
      permissions: 2,
    });
  } catch (err) {
    log.warn("auth/jellyfin sign-in failed:", err);
    return c.json({ message: "Unauthorized" }, 401);
  }
});

app.get("/auth/me", (c) => {
  const user = c.get("user");
  return c.json({
    id: compatIntId(user.id),
    email: user.email ?? "",
    displayName: user.name,
    username: user.name,
    permissions: 2, // REQUEST — Jellyseerr's bitmask for "can request", not admin.
  });
});

app.get("/languages", (c) => c.json([{ iso_639_1: "fr", english_name: "French", name: "Français" }]));

// ─── Title resolution (TMDB id -> Sofa's own internal title id) ─────────
// requestMovie/requestSeries take Sofa's own titleId, not a raw TMDB id -
// every real title on the site already has a row (browsing/searching
// creates one), but a request that targets something never browsed here
// needs one created first.

async function resolveTitleId(tmdbId: number, type: "movie" | "tv"): Promise<string> {
  const existing = await getExistingTitlesByTmdbIds([tmdbId]);
  if (existing.length > 0) return existing[0]!.id;

  const browseInput =
    type === "movie"
      ? await (async () => {
          const details = await getMovieDetails(tmdbId);
          return {
            tmdbId,
            type: "movie" as const,
            title: details.title ?? "",
            posterPath: details.poster_path ?? null,
            backdropPath: details.backdrop_path ?? null,
            releaseDate: details.release_date ?? null,
            firstAirDate: null,
            overview: details.overview ?? null,
            popularity: details.popularity ?? null,
            voteAverage: details.vote_average ?? null,
            voteCount: details.vote_count ?? null,
          };
        })()
      : await (async () => {
          const details = await getTvDetails(tmdbId);
          return {
            tmdbId,
            type: "tv" as const,
            title: details.name ?? "",
            posterPath: details.poster_path ?? null,
            backdropPath: details.backdrop_path ?? null,
            releaseDate: null,
            firstAirDate: details.first_air_date ?? null,
            overview: details.overview ?? null,
            popularity: details.popularity ?? null,
            voteAverage: details.vote_average ?? null,
            voteCount: details.vote_count ?? null,
          };
        })();
  const map = await ensureBrowseTitlesExist([browseInput]);
  const created = [...map.values()][0];
  if (!created) throw new Error(`Failed to create title row for tmdbId=${tmdbId}`);
  return created.id;
}

// ─── Requests ─────────────────────────────────────────────────

app.post("/request", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    mediaId: number;
    mediaType: "movie" | "tv";
    seasons?: number[] | "all";
    rootFolder?: string;
    profileId?: number;
  }>();

  try {
    const titleId = await resolveTitleId(body.mediaId, body.mediaType);
    if (body.mediaType === "movie") {
      await requestMovieFn(user.id, user.name, titleId, {
        rootFolderPath: body.rootFolder,
        qualityProfileId: body.profileId,
      });
    } else {
      const seasonNumbers = Array.isArray(body.seasons) ? body.seasons : undefined;
      await requestSeriesFn(user.id, user.name, titleId, {
        rootFolderPath: body.rootFolder,
        qualityProfileId: body.profileId,
        seasonNumbers,
      });
    }
    return c.json({ id: titleId, status: 2 /* PENDING_APPROVAL-ish */ }, 201);
  } catch (err) {
    if (err instanceof TitleNotFoundError) return c.json({ message: err.message }, 404);
    if (err instanceof AlreadyRequestedError) return c.json({ message: err.message }, 409);
    if (err instanceof NoTvdbIdError) return c.json({ message: err.message }, 400);
    if (err instanceof MediaRequestError) return c.json({ message: err.message }, 400);
    log.error("createRequest failed:", err);
    return c.json({ message: "Internal error" }, 500);
  }
});

// 28.09: Sofa's own request list/detail/approve/decline/retry/delete by
// Jellyseerr's numeric requestId don't have an equivalent yet on the Sofa
// side (Sofa's own request tracking is the titles table's
// requestedAt/requestedByUserId columns, not a separate request-id
// entity) - stubbed empty/no-op rather than guessing a shape, flagged for
// a follow-up once this first slice is confirmed working end-to-end.
app.get("/request", (c) => c.json({ pageInfo: { pages: 0, pageSize: 10, results: 0, page: 1 }, results: [] }));
app.get("/request/count", (c) =>
  c.json({ pending: 0, approved: 0, processing: 0, available: 0, total: 0 }),
);
// Same "no request-id entity on Sofa's side" gap as GET /request above -
// a request submitted via POST /request goes straight into
// titles.requestedAt with no intermediate approval state, so there is
// nothing real to fetch/delete/approve/decline/retry by id yet.
app.get("/request/:id", (c) => c.json({ message: "Not found" }, 404));
app.delete("/request/:id", (c) => c.body(null, 204));
app.post("/request/:id/approve", (c) => c.json({ message: "Not found" }, 404));
app.post("/request/:id/decline", (c) => c.json({ message: "Not found" }, 404));
app.post("/request/:id/retry", (c) => c.json({ message: "Not found" }, 404));

app.get("/request-options", async (c) => {
  const opts = await getRequestOptions();
  return c.json(opts);
});

// 28.09: Jellyseerr's "report a problem" issue tracker has no Sofa-side
// equivalent at all (no table, no concept) - stubbed the same honest way
// as the request-by-id gap above rather than inventing a feature.
app.get("/issue", (c) => c.json({ pageInfo: { pages: 0, pageSize: 10, results: 0, page: 1 }, results: [] }));
app.get("/issue/count", (c) =>
  c.json({ open: 0, closed: 0, total: 0, video: 0, audio: 0, subtitles: 0, others: 0 }),
);
app.post("/issue", (c) => c.json({ message: "Not implemented" }, 501));
app.get("/issue/:id", (c) => c.json({ message: "Not found" }, 404));
app.delete("/issue/:id", (c) => c.body(null, 204));
app.post("/issue/:id/comment", (c) => c.json({ message: "Not implemented" }, 501));
app.post("/issue/:id/:status", (c) => c.json({ message: "Not implemented" }, 501));

app.get("/user/:id/quota", (c) =>
  c.json({
    movie: { days: 0, limit: 0, used: 0, remaining: 0, restricted: false },
    tv: { days: 0, limit: 0, used: 0, remaining: 0, restricted: false },
  }),
);

// Jellyseerr's own recently-requested/available media list (its
// MediaInfo table) - same "no request-id entity" gap as /request above,
// not Emby's recently-added (Moonfin already gets that natively from
// Emby directly, unrelated to this Seerr-compat layer).
app.get("/media", (c) => c.json({ pageInfo: { pages: 0, pageSize: 10, results: 0, page: 1 }, results: [] }));

// ─── Radarr / Sonarr passthrough ────────────────────────────────
// Sofa only ever talks to a single Radarr/Sonarr instance each (unlike
// Jellyseerr's multi-server support) - both service/settings endpoints
// below always describe that one instance, id 0, regardless of the path
// param.

app.get("/service/radarr", async (c) => {
  const opts = await getRequestOptions();
  return c.json({
    server: { id: 0, name: "Radarr", is4k: false },
    profiles: opts.radarr.qualityProfiles,
    rootFolders: opts.radarr.rootFolders.map((f, i) => ({ id: i, path: f.path })),
  });
});
app.get("/service/radarr/:id", async (c) => {
  const opts = await getRequestOptions();
  return c.json({
    server: { id: 0, name: "Radarr", is4k: false },
    profiles: opts.radarr.qualityProfiles,
    rootFolders: opts.radarr.rootFolders.map((f, i) => ({ id: i, path: f.path })),
  });
});

app.get("/service/sonarr", async (c) => {
  const opts = await getRequestOptions();
  return c.json({
    server: { id: 0, name: "Sonarr", is4k: false },
    profiles: opts.sonarr.qualityProfiles,
    rootFolders: opts.sonarr.rootFolders.map((f, i) => ({ id: i, path: f.path })),
  });
});
app.get("/service/sonarr/:id", async (c) => {
  const opts = await getRequestOptions();
  return c.json({
    server: { id: 0, name: "Sonarr", is4k: false },
    profiles: opts.sonarr.qualityProfiles,
    rootFolders: opts.sonarr.rootFolders.map((f, i) => ({ id: i, path: f.path })),
  });
});

app.get("/settings/radarr", async (c) => {
  const opts = await getRequestOptions();
  return c.json([
    {
      id: 0,
      name: "Radarr",
      is4k: false,
      isDefault: true,
      activeProfileId: opts.radarr.qualityProfiles[0]?.id ?? 0,
      activeDirectory: opts.radarr.rootFolders[0]?.path ?? "",
    },
  ]);
});

app.get("/settings/sonarr", async (c) => {
  const opts = await getRequestOptions();
  return c.json([
    {
      id: 0,
      name: "Sonarr",
      is4k: false,
      isDefault: true,
      activeProfileId: opts.sonarr.qualityProfiles[0]?.id ?? 0,
      activeDirectory: opts.sonarr.rootFolders[0]?.path ?? "",
    },
  ]);
});

// ─── Discovery ────────────────────────────────────────────────

function requireTmdb(c: import("hono").Context) {
  if (!isTmdbConfigured()) {
    return c.json({ message: "TMDB is not configured" }, 412);
  }
  return null;
}

function mapResults(results: unknown[]) {
  return (results as Record<string, unknown>[]).map((r) => ({
    ...r,
    posterPath: undefined,
    poster_path: r.poster_path,
  }));
}

app.get("/discover/trending", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const page = Number(c.req.query("page") ?? "1");
  const data = await getTrending("all", "day", page);
  return c.json({ page: data.page, totalPages: data.total_pages, totalResults: data.total_results, results: mapResults(data.results ?? []) });
});

app.get("/discover/movies", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const page = Number(c.req.query("page") ?? "1");
  const data = await getPopular("movie", page);
  return c.json({ page: data.page, totalPages: data.total_pages, totalResults: data.total_results, results: mapResults(data.results ?? []) });
});

app.get("/discover/tv", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const page = Number(c.req.query("page") ?? "1");
  const data = await getPopular("tv", page);
  return c.json({ page: data.page, totalPages: data.total_pages, totalResults: data.total_results, results: mapResults(data.results ?? []) });
});

app.get("/discover/movies/upcoming", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const page = Number(c.req.query("page") ?? "1");
  const data = await getUpcomingMovies(page);
  return c.json({ page: data.page, totalPages: data.total_pages, totalResults: data.total_results, results: mapResults(data.results ?? []) });
});

app.get("/discover/movies/top", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const page = Number(c.req.query("page") ?? "1");
  const data = await discoverTmdb("movie", { sort_by: "vote_average.desc", "vote_count.gte": "200" }, page);
  return c.json({ page: data.page, totalPages: data.total_pages, totalResults: data.total_results, results: mapResults(data.results ?? []) });
});

app.get("/discover/tv/top", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const page = Number(c.req.query("page") ?? "1");
  const data = await discoverTmdb("tv", { sort_by: "vote_average.desc", "vote_count.gte": "200" }, page);
  return c.json({ page: data.page, totalPages: data.total_pages, totalResults: data.total_results, results: mapResults(data.results ?? []) });
});

app.get("/discover/tv/upcoming", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const page = Number(c.req.query("page") ?? "1");
  const today = new Date().toISOString().slice(0, 10);
  const data = await discoverTmdb(
    "tv",
    { sort_by: "first_air_date.asc", "first_air_date.gte": today },
    page,
  );
  return c.json({ page: data.page, totalPages: data.total_pages, totalResults: data.total_results, results: mapResults(data.results ?? []) });
});

// 28.09: Sofa's own per-user "watchlist" status (userTitleStatus table) is
// the closest match to Jellyseerr's separate watchlist concept - listing
// only covers titles Sofa already has a row for (browsed/searched at least
// once), same limitation as everywhere else in this file.
app.get("/discover/watchlist", async (c) => {
  const user = c.get("user");
  const page = Number(c.req.query("page") ?? "1");
  const rows = await getTitlesByUserStatus(user.id, "watchlist");
  const results = rows.map((r) => ({
    id: r.tmdbId,
    mediaType: r.type,
    title: r.type === "movie" ? r.title : undefined,
    name: r.type === "tv" ? r.title : undefined,
    overview: r.overview,
    posterPath: r.posterPath,
    poster_path: r.posterPath,
    releaseDate: r.releaseDate,
    release_date: r.releaseDate,
    firstAirDate: r.firstAirDate,
    first_air_date: r.firstAirDate,
    voteAverage: r.voteAverage,
    vote_average: r.voteAverage,
  }));
  return c.json({
    page,
    totalPages: 1,
    totalResults: results.length,
    results: page === 1 ? results : [],
  });
});

app.post("/watchlist", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ tmdbId: number; mediaType: "movie" | "tv" }>();
  const titleId = await resolveTitleId(body.tmdbId, body.mediaType);
  await setTitleStatus(user.id, titleId, "watchlist");
  return c.json({ ratingKey: body.tmdbId, mediaType: body.mediaType }, 201);
});

app.delete("/watchlist/:tmdbId", async (c) => {
  const user = c.get("user");
  const tmdbId = Number(c.req.param("tmdbId"));
  const [existing] = await getExistingTitlesByTmdbIds([tmdbId]);
  if (existing) await removeTitleStatus(user.id, existing.id);
  return c.body(null, 204);
});

app.get("/discover/genreslider/:type", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const type = c.req.param("type") === "tv" ? "tv" : "movie";
  const genres = await getGenres(type);
  return c.json(genres.genres ?? []);
});

// ─── Search ───────────────────────────────────────────────────

app.get("/search", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const query = c.req.query("query") ?? "";
  const page = Number(c.req.query("page") ?? "1");
  const data = await searchMulti(query, page);
  return c.json({ page: data.page, totalPages: data.total_pages, totalResults: data.total_results, results: mapResults(data.results ?? []) });
});

// ─── Title / person detail ────────────────────────────────────

app.get("/movie/:id", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const tmdbId = Number(c.req.param("id"));
  const details = await getMovieDetails(tmdbId);
  const [existing] = await getExistingTitlesByTmdbIds([tmdbId]);
  return c.json({ ...details, mediaInfo: existing ? { status: existing.requestedAt ? 3 : 1 } : undefined });
});

app.get("/tv/:id", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const tmdbId = Number(c.req.param("id"));
  const details = await getTvDetails(tmdbId);
  const [existing] = await getExistingTitlesByTmdbIds([tmdbId]);
  return c.json({ ...details, mediaInfo: existing ? { status: existing.requestedAt ? 3 : 1 } : undefined });
});

app.get("/tv/tvdb/:tvdbId", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const tvdbId = c.req.param("tvdbId");
  const found = await findByExternalId(tvdbId, "tvdb_id");
  const tvResult = (found.tv_results ?? [])[0] as { id: number } | undefined;
  if (!tvResult) return c.json({ message: "Not found" }, 404);
  const details = await getTvDetails(tvResult.id);
  const [existing] = await getExistingTitlesByTmdbIds([tvResult.id]);
  return c.json({ ...details, mediaInfo: existing ? { status: existing.requestedAt ? 3 : 1 } : undefined });
});

app.get("/movie/:id/similar", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const data = await getSimilar(Number(c.req.param("id")), "movie");
  return c.json({ page: 1, totalPages: 1, totalResults: (data.results ?? []).length, results: mapResults(data.results ?? []) });
});

app.get("/tv/:id/similar", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const data = await getSimilar(Number(c.req.param("id")), "tv");
  return c.json({ page: 1, totalPages: 1, totalResults: (data.results ?? []).length, results: mapResults(data.results ?? []) });
});

app.get("/movie/:id/recommendations", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const data = await getRecommendations(Number(c.req.param("id")), "movie");
  return c.json({ page: 1, totalPages: 1, totalResults: (data.results ?? []).length, results: mapResults(data.results ?? []) });
});

app.get("/tv/:id/recommendations", async (c) => {
  const err = requireTmdb(c);
  if (err) return err;
  const data = await getRecommendations(Number(c.req.param("id")), "tv");
  return c.json({ page: 1, totalPages: 1, totalResults: (data.results ?? []).length, results: mapResults(data.results ?? []) });
});

app.get("/person/:id", async (c) => {
  const data = await getPersonDetails(Number(c.req.param("id")));
  return c.json(data);
});

app.get("/person/:id/combined_credits", async (c) => {
  const data = await getPersonCombinedCredits(Number(c.req.param("id")));
  return c.json(data);
});

app.get("/collection/:id", (c) => {
  // Sofa has no collection/franchise grouping concept yet - follow-up.
  return c.json({ message: "Not implemented" }, 501);
});

export default app;
