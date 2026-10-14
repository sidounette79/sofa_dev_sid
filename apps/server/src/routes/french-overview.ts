import { Hono } from "hono";

import { hydrateFrenchEpisodeTranslations } from "@sofa/core/metadata";
import { getTitleByTmdbIdAndType } from "@sofa/db/queries/metadata";
import { findEpisodeBySeasonAndNumber, findSeasonByTitleAndNumber } from "@sofa/db/queries/title";
import { createLogger } from "@sofa/logger";

const log = createLogger("french-overview");
const app = new Hono();

// 29.09, Sid: Moonfin (the Emby client) shows whatever text Emby's TVDB
// plugin gives it, which is only the base/default TVDB record - TVDB's
// French community translations live behind a separate `/translations/fra`
// endpoint the Emby plugin never calls (see packages/tvdb/src/client.ts).
// Sofa already solved this for its own pages (getOrFetchTitle, below).
// Rather than embed TVDB_API_KEY in the Moonfin APK, Moonfin asks Sofa for
// the already-hydrated (or hydrated-on-demand here) French text, keyed by
// the tmdbId Emby already exposes on every item via ProviderIds.Tmdb.
// Unauthenticated, same convention as emby-images/images - this server
// isn't multi-tenant, and the response carries no user data.
app.get("/", async (c) => {
  const tmdbIdRaw = c.req.query("tmdbId");
  const type = c.req.query("type");
  const seasonRaw = c.req.query("season");
  const episodeRaw = c.req.query("episode");

  const tmdbId = tmdbIdRaw ? Number(tmdbIdRaw) : NaN;
  if (!Number.isFinite(tmdbId) || (type !== "movie" && type !== "tv")) {
    return c.json({ error: "tmdbId and type=movie|tv are required" }, 400);
  }

  const [title] = await getTitleByTmdbIdAndType(tmdbId, type);
  if (!title) {
    return c.json({ name: null, overview: null });
  }

  // TVDB translation hydration only applies to TV (movies have no TVDB
  // season/episode structure - see schema.ts's overviewFr doc comment).
  // Skipping it still leaves title.overview usable below: Sofa's own TMDB
  // client defaults every call to language=fr-FR, so the base text is
  // already French whenever TMDB itself has a translation - the TVDB
  // layer is a quality upgrade on top, not the only French source.
  if (type === "tv" && title.tvdbId && !title.tvdbTranslatedAt) {
    try {
      await hydrateFrenchEpisodeTranslations(title.id, title.tvdbId);
    } catch (err) {
      log.warn(`French hydration failed for tmdbId ${tmdbId}:`, err);
    }
  }

  const season = seasonRaw ? Number(seasonRaw) : null;
  const episode = episodeRaw ? Number(episodeRaw) : null;

  if (type === "movie" || season === null || episode === null) {
    // Series/movie-level request - same "translation over base" read as
    // getOrFetchTitle's own "French (TVDB) over English (TMDB)" comment.
    return c.json({
      name: title.title,
      overview: title.overviewFr ?? title.overview,
    });
  }

  if (!Number.isFinite(season) || !Number.isFinite(episode)) {
    return c.json({ error: "season and episode must be numbers" }, 400);
  }

  const [seasonRow] = await findSeasonByTitleAndNumber(title.id, season);
  const [episodeRow] = seasonRow ? await findEpisodeBySeasonAndNumber(seasonRow.id, episode) : [null];

  return c.json({
    name: episodeRow?.nameFr ?? episodeRow?.name ?? null,
    overview: episodeRow?.overviewFr ?? episodeRow?.overview ?? null,
  });
});

export default app;
