/*
 * 31.08, Sid — safety net for a real gap she asked about: "si sofa est down
 * et que emby envoie un webhook, ca garde en mémoire ou la mise à jour est
 * perdue ?". Verified in webhooks.ts: nothing on Sofa's side queues or
 * retries a webhook it never received (the HTTP request itself never
 * reaches any Sofa code while the server is down), and no periodic job
 * re-synced watch status from Emby — only library *content* gets a
 * recurring scan (scanEmbyLibrary), never play state. This job closes that
 * gap: for every linked Emby account, diff Emby's real "played" list
 * against what Sofa already has logged, and backfill anything missing
 * through the normal logMovieWatch/logEpisodeWatch path (so status
 * transitions, rewatch cycles, and CARBA mirroring all behave exactly as
 * if the original webhook had arrived).
 *
 * Deliberately approximate on timestamps: Emby's played-items list doesn't
 * expose a reliable "last played at" without extra per-item requests, so a
 * backfilled watch is timestamped "now" (when this job noticed the gap),
 * not when it actually happened. Good enough for a safety net whose whole
 * point is "don't lose the watch" — not for a viewing-history timeline.
 */
import { EMBY_API_KEY, EMBY_URL } from "@sofa/config";
import { getEnabledEmbyIntegrationsWithUsername } from "@sofa/db/queries/integrations";
import {
  getEpisodesByEmbyItemId,
  getMovieTitleIdsByEmbyItemId,
  getTitleCyclesByTitleIds,
  getWatchedEpisodeCycleKeysForUser,
  getWatchedMovieTitleIdsForUser,
} from "@sofa/db/queries/tracking";
import { createLogger } from "@sofa/logger";

import { embyFetch, getEmbyUserIdsByUsername } from "./emby";
import { logEpisodeWatch, logMovieWatch } from "./tracking";

const log = createLogger("emby-watch-reconciliation");

interface EmbyPlayedItem {
  Id: string;
}

interface EmbyItemsPage {
  Items: EmbyPlayedItem[];
  TotalRecordCount: number;
}

async function fetchPlayedItemIds(embyUserId: string, itemType: "Movie" | "Episode") {
  const ids: string[] = [];
  const pageSize = 500;
  let startIndex = 0;

  for (;;) {
    const page = await embyFetch<EmbyItemsPage>(
      `/Users/${embyUserId}/Items?Recursive=true&IncludeItemTypes=${itemType}` +
        `&Filters=IsPlayed&Fields=Id&StartIndex=${startIndex}&Limit=${pageSize}`,
    );
    ids.push(...page.Items.map((i) => i.Id));
    startIndex += page.Items.length;
    if (page.Items.length < pageSize || startIndex >= page.TotalRecordCount) break;
  }
  return ids;
}

export async function reconcileEmbyWatchStatus(): Promise<{
  usersChecked: number;
  moviesBackfilled: number;
  episodesBackfilled: number;
}> {
  const result = { usersChecked: 0, moviesBackfilled: 0, episodesBackfilled: 0 };

  if (!EMBY_URL || !EMBY_API_KEY) return result;

  const integrationsToCheck = await getEnabledEmbyIntegrationsWithUsername();
  if (integrationsToCheck.length === 0) return result;

  const embyUserIdByName = await getEmbyUserIdsByUsername();

  // 17.09, Sid: found via the same "check the exact cron minute against
  // cron.ts" trick that pinned syncRequestedFromRadarrSonarr (see
  // [[project_sofa_titles_tvdbid_missing_index]]) — a heartbeat stall at
  // :35 lines up with THIS job's schedule. Step timing to find out whether
  // it's the same missing-index shape or genuinely just a big read (157k
  // episodes / 53k watches), before touching anything.
  let stepStart = performance.now();
  function logStep(label: string) {
    const ms = Math.round(performance.now() - stepStart);
    if (ms > 500) log.warn(`reconcileEmbyWatchStatus: ${label} took ${ms}ms`);
    stepStart = performance.now();
  }

  // Built once, reused across every user checked this run.
  const movieTitleIdByEmbyItemId = await getMovieTitleIdsByEmbyItemId();
  logStep(`getMovieTitleIdsByEmbyItemId() (${movieTitleIdByEmbyItemId.size} entries)`);
  const episodeByEmbyItemId = await getEpisodesByEmbyItemId();
  logStep(`getEpisodesByEmbyItemId() (${episodeByEmbyItemId.size} entries)`);

  for (const { userId, embyUsername } of integrationsToCheck) {
    const embyUserId = embyUserIdByName.get(embyUsername.toLowerCase());
    if (!embyUserId) {
      log.warn(`No matching Emby account found for linked username "${embyUsername}"`);
      continue;
    }

    try {
      const [playedMovieItemIds, playedEpisodeItemIds] = await Promise.all([
        fetchPlayedItemIds(embyUserId, "Movie"),
        fetchPlayedItemIds(embyUserId, "Episode"),
      ]);
      logStep(
        `fetchPlayedItemIds() for "${embyUsername}" (${playedMovieItemIds.length} movies, ${playedEpisodeItemIds.length} episodes)`,
      );

      const alreadyWatchedTitleIds = await getWatchedMovieTitleIdsForUser(userId);
      let moviesBackfilledForUser = 0;
      for (const embyItemId of playedMovieItemIds) {
        const titleId = movieTitleIdByEmbyItemId.get(embyItemId);
        if (!titleId || alreadyWatchedTitleIds.has(titleId)) continue;
        await logMovieWatch(userId, titleId, "emby");
        moviesBackfilledForUser++;
      }
      logStep(`movie backfill loop for "${embyUsername}"`);

      // Cycle-aware: a played episode only counts as "already accounted
      // for" if it was logged in the title's *current* rewatch cycle for
      // this user — a watch from a past cycle (e.g. an old import, or the
      // first watch-through) must never mask a genuinely unlogged rewatch.
      const playedTitleIds = new Set(
        playedEpisodeItemIds
          .map((id) => episodeByEmbyItemId.get(id)?.titleId)
          .filter((id): id is string => id !== undefined),
      );
      const currentCycleByTitleId = await getTitleCyclesByTitleIds(userId, [...playedTitleIds]);
      const watchedCycleKeys = await getWatchedEpisodeCycleKeysForUser(userId);
      logStep(
        `getTitleCyclesByTitleIds() + getWatchedEpisodeCycleKeysForUser() for "${embyUsername}" (${watchedCycleKeys.size} watched keys)`,
      );
      let episodesBackfilledForUser = 0;
      for (const embyItemId of playedEpisodeItemIds) {
        const episode = episodeByEmbyItemId.get(embyItemId);
        if (!episode) continue;
        const currentCycle = currentCycleByTitleId.get(episode.titleId) ?? 1;
        if (watchedCycleKeys.has(`${episode.episodeId}:${currentCycle}`)) continue;
        await logEpisodeWatch(userId, episode.episodeId, "emby");
        episodesBackfilledForUser++;
      }
      logStep(`episode backfill loop for "${embyUsername}"`);

      if (moviesBackfilledForUser > 0 || episodesBackfilledForUser > 0) {
        log.info(
          `Reconciliation backfilled ${moviesBackfilledForUser} movie(s) and ` +
            `${episodesBackfilledForUser} episode(s) for "${embyUsername}" — ` +
            `missed while Sofa was unreachable, or a webhook that never arrived.`,
        );
      }
      result.usersChecked++;
      result.moviesBackfilled += moviesBackfilledForUser;
      result.episodesBackfilled += episodesBackfilledForUser;
    } catch (err) {
      log.warn(`Reconciliation failed for "${embyUsername}":`, err);
    }
  }

  return result;
}
