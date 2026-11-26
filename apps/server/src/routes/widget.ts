import { Hono } from "hono";

import { getContinueWatchingFeed, getUpcomingFeed } from "@sofa/core/discovery";
import { getEmbyUserFromToken } from "@sofa/core/emby";
import { getUpcomingEpisodes } from "@sofa/db/queries/discovery";
import { getEnabledEmbyIntegrationsWithUsername } from "@sofa/db/queries/integrations";
import { createLogger } from "@sofa/logger";

const log = createLogger("widget");

const app = new Hono();

// 24.11, Sid — home-screen widgets for CARBA TV mobile, replacing the ones
// she had in her previous tracking app (screenshots: "Prochains épisodes à
// voir", "Prochaines diffusions", "Épisodes récemment diffusés").
//
// Auth deliberately reuses the Emby bridge rather than minting a widget
// secret: CARBA TV already holds a valid Emby token, and her Emby webhook
// already records which Emby account maps to which Patoune TV user
// (integrations.embyUsername). So the widget sends the token it has, and
// nothing has to be configured or copied by hand. Her own suggestion -
// "j'ai un webhook qui cause entre emby et patoune TV, ca peut servir?" -
// which replaced a planned token table.
//
// Emby usernames are matched case-insensitively: the webhook stores
// whatever Emby reported at setup time ("xa" for xacarr), and there is no
// guarantee /Users/Me reports the exact same casing.
async function requireUserId(c: {
  req: { header: (name: string) => string | undefined };
}): Promise<string | null> {
  const token = c.req.header("X-Emby-Token");
  if (!token) {
    // 26.11 : on journalise CHAQUE appel, succes compris. Les widgets
    // restaient vides et le serveur ne voyait rien passer : impossible de
    // dire si l'app n'appelait pas, ou si elle appelait et echouait.
    log.info("appel widget SANS jeton");
    return null;
  }

  const embyUser = await getEmbyUserFromToken(token);
  if (!embyUser) {
    log.warn(`appel widget avec un jeton qu'Emby refuse (${token.slice(0, 6)}…)`);
    return null;
  }

  const integrations = await getEnabledEmbyIntegrationsWithUsername();
  const wanted = embyUser.name.toLowerCase();
  const match = integrations.find((row) => row.embyUsername?.toLowerCase() === wanted);
  if (!match) {
    log.warn(`appel widget : aucun compte Patoune TV lie a l'utilisateur Emby "${embyUser.name}"`);
    return null;
  }
  log.info(`appel widget reconnu : Emby "${embyUser.name}"`);
  return match.userId;
}

/** Bounded so a malformed widget request can't ask for the whole library. */
function readLimit(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 50);
}

function readDays(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), 1), 365);
}

/** Local calendar date (YYYY-MM-DD), matching how airDate is stored. */
function localDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

// "9-1-1 / S10E01 à voir – That Sinking Feeling / 6 épisodes non vus"
app.get("/continue-watching", async (c) => {
  const userId = await requireUserId(c);
  if (!userId) return c.json({ error: "Invalid or missing Emby token" }, 401);

  const limit = readLimit(c.req.query("limit"), 10);
  const feed = await getContinueWatchingFeed(userId);

  const items = feed
    .filter((entry) => entry.nextEpisode !== null)
    .slice(0, limit)
    .map((entry) => ({
      titleId: entry.title.id,
      title: entry.title.title,
      posterPath: entry.title.posterPath,
      seasonNumber: entry.nextEpisode?.seasonNumber ?? null,
      episodeNumber: entry.nextEpisode?.episodeNumber ?? null,
      episodeName: entry.nextEpisode?.name ?? null,
      // Ce que l'ancienne app affichait en 3e ligne ("6 épisodes non vus").
      unwatchedCount: Math.max(entry.totalEpisodes - entry.watchedEpisodes, 0),
      embyItemId: entry.nextEpisode?.embyItemId ?? null,
    }));

  return c.json({ items });
});

// "9-1-1 / S10E07 Old Wounds / 08/01/2027 – dans 45 jours"
app.get("/upcoming", async (c) => {
  const userId = await requireUserId(c);
  if (!userId) return c.json({ error: "Invalid or missing Emby token" }, 401);

  const limit = readLimit(c.req.query("limit"), 10);
  const days = readDays(c.req.query("days"), 90);
  const feed = await getUpcomingFeed(userId, { days, limit, mediaType: "tv" });

  const items = feed.items.slice(0, limit).map((item) => ({
    titleId: item.titleId,
    title: item.titleName,
    posterPath: item.posterPath,
    seasonNumber: item.seasonNumber,
    episodeNumber: item.episodeNumber,
    episodeName: item.episodeName,
    airDate: item.date,
    episodeCount: item.episodeCount,
  }));

  return c.json({ items });
});

// "Yellowjackets / S04E01 Hivemind / 23/11/2026 – il y a 1 jour"
//
// Pas de nouvelle requête : getUpcomingEpisodes prend déjà une plage de
// dates, il suffit de la placer dans le passé et d'inverser le tri. Elle
// exclut déjà les séries abandonnées.
app.get("/recently-aired", async (c) => {
  const userId = await requireUserId(c);
  if (!userId) return c.json({ error: "Invalid or missing Emby token" }, 401);

  const limit = readLimit(c.req.query("limit"), 10);
  const days = readDays(c.req.query("days"), 14);

  const rows = await getUpcomingEpisodes(userId, localDate(-days), localDate(0));

  const items = rows
    .filter((row) => row.airDate !== null)
    .sort((a, b) => (b.airDate ?? "").localeCompare(a.airDate ?? ""))
    .slice(0, limit)
    .map((row) => ({
      titleId: row.titleId,
      title: row.titleName,
      posterPath: row.posterPath,
      seasonNumber: row.seasonNumber,
      episodeNumber: row.episodeNumber,
      episodeName: row.episodeName,
      airDate: row.airDate,
    }));

  return c.json({ items });
});

export default app;
