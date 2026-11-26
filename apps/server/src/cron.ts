import { Cron } from "croner";
import { setTimeout as sleep } from "node:timers/promises";

import { refreshAvailability } from "@sofa/core/availability";
import { createBackup, ensureBackupDir, pruneBackups } from "@sofa/core/backup";
import { refreshCredits, syncCastProfileThumbHashes } from "@sofa/core/credits";
import {
  completeCronRun,
  failCronRun,
  getCastEntryForTitle,
  getLibraryTitleIds,
  getReturningTvShows,
  getStaleAvailabilityTitles,
  getStaleLibraryTitles,
  getStaleNonLibraryTitlesForRefresh,
  getThumbhashBackfillTitleIds,
  getTitleByIdForCron,
  getTitleIdsWithStaleSeasons,
  getTitlesWithFreshRecommendations,
  startCronRun,
} from "@sofa/core/cron";
import {
  cacheEpisodeStills,
  cacheImagesForTitle,
  cacheProfilePhotos,
  cacheProviderLogos,
  imageCacheEnabled,
} from "@sofa/core/image-cache";
import {
  refreshRecommendations,
  refreshTitle,
  refreshTvChildren,
  syncTvChildArt,
} from "@sofa/core/metadata";
import { scanEmbyLibrary } from "@sofa/core/emby-library";
import { reconcileEmbyWatchStatus } from "@sofa/core/emby-watch-reconciliation";
import { syncRequestedFromRadarrSonarr } from "@sofa/core/media-requests";
import { notifyEpisodeReleased } from "@sofa/core/push";
import { getSetting } from "@sofa/core/settings";
import {
  getUnnotifiedEpisodesAiringOn,
  markEpisodeNotified,
} from "@sofa/db/queries/notifications";
import { generateTitleBackdropThumbHash, generateTitlePosterThumbHash } from "@sofa/core/thumbhash";
import { performUpdateCheck } from "@sofa/core/update-check";
import { createLogger } from "@sofa/logger";
import { getTvDetails, TmdbNotFoundError } from "@sofa/tmdb/client";

export type BackupFrequency = "6h" | "12h" | "1d" | "7d";

const log = createLogger("cron");

const DAY = 24 * 60 * 60 * 1000;
const RATE_LIMIT_MS = 300;

/**
 * Log a per-title failure inside a refresh loop without re-throwing — a
 * title TMDB no longer has (seen 17.08: TMDB returned 404 for a show that
 * used to exist, "Monster" tv/329491, likely removed/merged on their end)
 * used to throw straight out of the loop, aborting the whole nightly job
 * AND leaving every other stale title in that run un-refreshed — not just a
 * skipped title, a skipped rest-of-the-batch, silently, every night. Only
 * `TmdbNotFoundError` gets its own message; anything else still surfaces at
 * `warn` so a real transient failure isn't hidden.
 */
function logTitleRefreshFailure(jobName: string, titleId: string, err: unknown): void {
  if (err instanceof TmdbNotFoundError) {
    log.warn(`[${jobName}] Title ${titleId} no longer exists on TMDB, skipping: ${err.message}`);
  } else {
    log.warn(`[${jobName}] Failed to refresh title ${titleId}:`, err);
  }
}

const globalForJobs = globalThis as unknown as {
  _jobs: Map<string, Cron> | undefined;
};

if (!globalForJobs._jobs) {
  globalForJobs._jobs = new Map<string, Cron>();
}
const jobs = globalForJobs._jobs;

function schedule(name: string, cron: string, handler: () => Promise<void>) {
  jobs.set(
    name,
    new Cron(cron, { name, protect: true }, async () => {
      log.debug(`Running job: ${name}`);
      const startMs = performance.now();
      const run = await startCronRun(name);
      try {
        await handler();
        const durationMs = Math.round(performance.now() - startMs);
        if (run) await completeCronRun(run.id, durationMs);
        log.debug(`Completed job: ${name} (${durationMs}ms)`);
      } catch (err) {
        const durationMs = Math.round(performance.now() - startMs);
        if (run) await failCronRun(run.id, durationMs, err);
        log.error(`Job ${name} failed:`, err);
      }
    }),
  );
}

/** Get schedule metadata for all registered jobs */
export function getJobSchedules(): {
  jobName: string;
  pattern: string;
  nextRunAt: string | null;
}[] {
  return Array.from(jobs.entries(), ([name, cron]) => ({
    jobName: name,
    pattern: cron.getPattern() ?? "",
    nextRunAt: cron.nextRun()?.toISOString() ?? null,
  }));
}

/** Manually trigger a job by name. Returns false if job not found or already running. */
export async function triggerJob(name: string): Promise<boolean> {
  const job = jobs.get(name);
  if (!job) return false;
  if (job.isBusy()) return false;
  await job.trigger();
  return true;
}

// Refresh titles where lastFetchedAt is stale
async function nightlyRefreshLibrary() {
  const libraryIds = await getLibraryTitleIds();
  log.debug(`Checking ${libraryIds.length} library titles for staleness`);
  const libraryStale = new Date(Date.now() - 7 * DAY);
  const nonLibraryStale = new Date(Date.now() - 30 * DAY);

  // Library titles: 7 days
  const staleLibrary = await getStaleLibraryTitles(libraryIds, libraryStale);

  for (const { id } of staleLibrary) {
    try {
      await refreshTitle(id);
    } catch (err) {
      logTitleRefreshFailure("nightlyRefreshLibrary", id, err);
    }
    await sleep(RATE_LIMIT_MS);
  }

  // Non-library titles: 30 days
  const nonLibrary = await getStaleNonLibraryTitlesForRefresh(nonLibraryStale, 50);

  for (const t of nonLibrary) {
    if (!libraryIds.includes(t.id)) {
      try {
        await refreshTitle(t.id);
      } catch (err) {
        logTitleRefreshFailure("nightlyRefreshLibrary", t.id, err);
      }
      await sleep(RATE_LIMIT_MS);
    }
  }
}

// Refresh availability for library titles where stale
async function refreshAvailabilityJob() {
  const libraryIds = await getLibraryTitleIds();
  log.debug(`Checking availability for ${libraryIds.length} library titles`);
  const stale = new Date(Date.now() - DAY);

  const { withOffers, withStaleOffers } = await getStaleAvailabilityTitles(libraryIds, stale);

  for (const titleId of libraryIds) {
    if (withStaleOffers.has(titleId) || !withOffers.has(titleId)) {
      try {
        await refreshAvailability(titleId);
      } catch (err) {
        logTitleRefreshFailure("refreshAvailabilityJob", titleId, err);
      }
      await sleep(RATE_LIMIT_MS);
    }
  }
}

async function refreshRecommendationsJob() {
  const libraryIds = await getLibraryTitleIds();
  const stale = new Date(Date.now() - 7 * DAY);
  const fresh = await getTitlesWithFreshRecommendations(libraryIds, stale);
  const staleIds = libraryIds.filter((id) => !fresh.has(id));
  log.debug(
    `Refreshing recommendations for ${staleIds.length} of ${libraryIds.length} library titles`,
  );

  for (const titleId of staleIds) {
    try {
      await refreshRecommendations(titleId);
    } catch (err) {
      logTitleRefreshFailure("refreshRecommendationsJob", titleId, err);
    }
    await sleep(RATE_LIMIT_MS);
  }
}

async function refreshTvChildrenJob() {
  const stale = new Date(Date.now() - 7 * DAY);

  const tvShows = await getReturningTvShows();

  log.debug(`Checking ${tvShows.length} returning TV shows for stale episodes`);

  const tvIds = tvShows.map((s) => s.id);
  const titlesWithStaleSeasons = await getTitleIdsWithStaleSeasons(tvIds, stale);

  for (const show of tvShows) {
    if (titlesWithStaleSeasons.has(show.id)) {
      try {
        const details = await getTvDetails(show.tmdbId);
        await refreshTvChildren(show.id, show.tmdbId, details.number_of_seasons);
        await syncTvChildArt(show.id, { warmCache: true });
      } catch (err) {
        logTitleRefreshFailure("refreshTvChildrenJob", show.id, err);
      }
      await sleep(RATE_LIMIT_MS);
    }
  }
}

// New-episode push notifications (20.08, Sid). Deliberately its own job
// rather than piggybacking on nightlyRefreshLibrary (03:00) — she'd never
// see a 3am push before her phone silences it overnight. 09:00 instead:
// by then the overnight TMDB refresh has already caught any air-date
// corrections, so "airing today" here reflects the day's real lineup, not
// stale data from before the season was added.
async function notifyNewEpisodesJob() {
  const today = formatLocalDateCron(new Date());
  const airingToday = await getUnnotifiedEpisodesAiringOn(today);
  log.debug(`Notifying for ${airingToday.length} episode(s) airing ${today}`);

  for (const ep of airingToday) {
    try {
      await notifyEpisodeReleased(
        ep.titleId,
        ep.titleName,
        ep.seasonNumber,
        ep.episodeNumber,
        ep.episodeName,
      );
    } catch (err) {
      log.warn(`Failed to send episode-release notification for ${ep.titleId}:`, err);
    }
    // Marked regardless of push success/failure — a subscription hiccup
    // shouldn't turn into a daily retry storm for the same episode.
    await markEpisodeNotified(ep.episodeId);
  }
}

function formatLocalDateCron(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function cacheImagesJob() {
  const titleIds = await getThumbhashBackfillTitleIds();
  log.debug(`Caching images for ${titleIds.length} titles needing art backfill`);

  for (const titleId of titleIds) {
    try {
      const [title] = await getTitleByIdForCron(titleId);
      if (!title) continue;

      // Phase 1: warm the image cache so thumbhash generation can read from disk
      if (imageCacheEnabled()) {
        await Promise.all([
          cacheImagesForTitle(titleId),
          cacheEpisodeStills(titleId),
          cacheProviderLogos(titleId),
          cacheProfilePhotos(titleId),
        ]);
      }

      // Phase 2: generate thumbhashes (reads from warm cache, no duplicate downloads)
      const hashTasks: Promise<unknown>[] = [];

      if (!title.posterThumbHash && title.posterPath) {
        hashTasks.push(generateTitlePosterThumbHash(titleId, title.posterPath));
      }
      if (!title.backdropThumbHash && title.backdropPath) {
        hashTasks.push(generateTitleBackdropThumbHash(titleId, title.backdropPath));
      }

      if (title.type === "tv") {
        hashTasks.push(syncTvChildArt(titleId, { warmCache: false }));
      }

      hashTasks.push(syncCastProfileThumbHashes(titleId, undefined, { warmCache: false }));

      await Promise.all(hashTasks);
    } catch (err) {
      log.warn(`Failed to cache images for title ${titleId}:`, err);
    }
    await sleep(RATE_LIMIT_MS);
  }
}

async function refreshCreditsJob() {
  const libraryIds = await getLibraryTitleIds();
  log.debug(`Checking credits for ${libraryIds.length} library titles`);
  const stale = new Date(Date.now() - 30 * DAY);

  for (const titleId of libraryIds) {
    const [castEntry] = await getCastEntryForTitle(titleId);

    const needsRefresh = !castEntry || !castEntry.lastFetchedAt || castEntry.lastFetchedAt < stale;

    if (needsRefresh) {
      await refreshCredits(titleId);
      await sleep(RATE_LIMIT_MS);
    }
  }
}

async function scheduledBackupJob() {
  const enabled = await getSetting("scheduledBackups");
  if (enabled !== "true") {
    log.debug("Scheduled backups disabled, skipping");
    return;
  }

  await ensureBackupDir();
  await createBackup("sofa-scheduled");

  const maxStr = await getSetting("maxBackupRetention");
  const max = maxStr ? Number.parseInt(maxStr, 10) : 7;
  await pruneBackups(max);
}

export function buildBackupCron(
  frequency: BackupFrequency = "1d",
  time = "02:00",
  dayOfWeek = 0,
): string {
  const [hour, minute] = time.split(":").map(Number);
  const h = Number.isFinite(hour) ? hour : 2;
  const m = Number.isFinite(minute) ? minute : 0;
  const dow = dayOfWeek >= 0 && dayOfWeek <= 6 ? dayOfWeek : 0;

  switch (frequency) {
    case "6h":
      return `${m} ${h},${(h + 6) % 24},${(h + 12) % 24},${(h + 18) % 24} * * *`;
    case "12h":
      return `${m} ${h},${(h + 12) % 24} * * *`;
    case "7d":
      return `${m} ${h} * * ${dow}`;
    default:
      return `${m} ${h} * * *`;
  }
}

async function getBackupCronFromSettings(): Promise<string> {
  const [frequency, time, dowStr] = await Promise.all([
    getSetting("backupScheduleFrequency"),
    getSetting("backupScheduleTime"),
    getSetting("backupScheduleDow"),
  ]);
  const dayOfWeek = Number.parseInt(dowStr ?? "0", 10);
  return buildBackupCron((frequency ?? "1d") as BackupFrequency, time ?? "02:00", dayOfWeek);
}

export async function rescheduleBackup() {
  const existing = jobs.get("scheduledBackup");
  if (existing) {
    existing.stop();
    jobs.delete("scheduledBackup");
  }
  const cron = await getBackupCronFromSettings();
  log.debug(`Rescheduling backup job with cron: ${cron}`);
  schedule("scheduledBackup", cron, scheduledBackupJob);
}

export async function startJobs() {
  if (jobs.size > 0) return;

  // 08.10, Patoune TV / Postgres migration: replaces the standalone
  // title-episode-stats-worker.ts Bun Worker thread - see
  // packages/db/src/queries/title-episode-stats.ts's own comment for why a
  // dedicated thread is no longer needed on Postgres. Same 5-minute cadence.
  schedule("refreshTitleEpisodeStats", "*/5 * * * *", async () => {
    const { refreshTitleEpisodeStats } = await import("@sofa/db/queries/title-episode-stats");
    await refreshTitleEpisodeStats();
  });
  // Matches the old worker's own immediate first run (before its
  // setInterval) - avoids up to 5 minutes of stale/empty stats right after
  // a fresh deploy or restart. Fire-and-forget: startup shouldn't block on it.
  import("@sofa/db/queries/title-episode-stats").then(({ refreshTitleEpisodeStats }) =>
    refreshTitleEpisodeStats().catch((err) => log.error("Initial title-episode-stats refresh failed:", err)),
  );

  schedule("scheduledBackup", await getBackupCronFromSettings(), scheduledBackupJob);
  schedule("nightlyRefreshLibrary", "0 3 * * *", nightlyRefreshLibrary);
  schedule("refreshAvailability", "0 */6 * * *", refreshAvailabilityJob);
  schedule("scanEmbyLibrary", "15 */6 * * *", async () => {
    await scanEmbyLibrary();
  });
  // 31.08, Sid — safety net answering "si sofa est down et que emby envoie
  // un webhook, ca garde en mémoire ou la mise à jour est perdue ?": it's
  // lost, nothing queues it. This diffs Emby's real played state against
  // Sofa's and backfills any gap. Offset 20min after scanEmbyLibrary so a
  // library scan (which can add new titles/episodes with fresh embyItemIds)
  // has already landed before this tries to match against them.
  schedule("reconcileEmbyWatchStatus", "35 */6 * * *", async () => {
    await reconcileEmbyWatchStatus();
  });
  // Lighter/cheaper than the Emby scan (two flat API list calls, no
  // per-library pagination), so this can afford to run hourly instead of
  // every 6h — keeps the "already requested" badge reasonably fresh for
  // requests made straight in Radarr/Sonarr instead of through Sofa.
  schedule("syncRequestedFromRadarrSonarr", "40 * * * *", async () => {
    await syncRequestedFromRadarrSonarr();
  });
  schedule("refreshRecommendations", "0 */12 * * *", refreshRecommendationsJob);
  schedule("refreshTvChildren", "30 */12 * * *", refreshTvChildrenJob);
  schedule("notifyNewEpisodes", "0 9 * * *", notifyNewEpisodesJob);
  schedule("cacheImages", "0 1,13 * * *", cacheImagesJob);
  schedule("refreshCredits", "0 2 * * *", refreshCreditsJob);
  // 21.08: books are now fully owned by Grimmory (native watch-author/
  // missing-books tracking there) — Sofa's own book-tracking backend is
  // being decommissioned. These 3 jobs, and the Hardcover/Wikipedia/
  // OpenLibrary calls they made, are exactly what a recurring multi-minute
  // full-server freeze traced back to (a missing fetch timeout in
  // packages/core/src/books.ts — fixed regardless, but this feature has no
  // reason to keep running now that Grimmory covers it).
  schedule("updateCheck", "0 */6 * * *", async () => {
    await performUpdateCheck();
  });
  // 08.10, Patoune TV / Postgres migration: this job used to also own WAL
  // checkpointing (SQLite-specific, see the Sofa migration notes/
  // project_patoune_tv_rebuild memory) - Postgres manages its own
  // WAL/vacuuming via autovacuum, nothing to trigger manually here anymore.
  // Kept as a plain retention-cleanup job (old cron run/integration-event/
  // session/verification rows) plus ANALYZE to refresh planner stats.
  schedule("optimizeDb", "0 4 * * 0", async () => {
    const { optimizeDatabase } = await import("@sofa/db/client");
    const { deleteOldCronRuns } = await import("@sofa/db/queries/cron");
    const { deleteOldIntegrationEvents } = await import("@sofa/db/queries/webhooks");
    const { deleteExpiredSessions, deleteExpiredVerifications } =
      await import("@sofa/db/queries/auth-cleanup");

    const retentionDate = new Date(Date.now() - 30 * DAY);
    const [cronDeleted, eventsDeleted, sessionsDeleted, verificationsDeleted] = await Promise.all([
      deleteOldCronRuns(retentionDate),
      deleteOldIntegrationEvents(retentionDate),
      deleteExpiredSessions(),
      deleteExpiredVerifications(),
    ]);

    if (cronDeleted + eventsDeleted + sessionsDeleted + verificationsDeleted > 0) {
      log.info(
        `Pruned ${cronDeleted} cron runs, ${eventsDeleted} integration events, ${sessionsDeleted} sessions, ${verificationsDeleted} verifications`,
      );
    }

    await optimizeDatabase();
  });

  log.debug(`Registered ${jobs.size} scheduled jobs`);
}

export function pauseJobs() {
  for (const job of jobs.values()) {
    job.pause();
  }
}

export function resumeJobs() {
  for (const job of jobs.values()) {
    job.resume();
  }
}

export function stopJobs() {
  for (const job of jobs.values()) {
    job.stop();
  }
}
