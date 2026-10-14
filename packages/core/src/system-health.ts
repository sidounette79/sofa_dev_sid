import { access, constants, readdir, stat } from "node:fs/promises";
import path from "node:path";

import { CACHE_DIR, DATA_DIR, TMDB_API_BASE_URL } from "@sofa/config";
import { getDatabaseSizeBytes, getLatestCronRuns, getTableCounts } from "@sofa/db/queries/system-health";
import { createLogger } from "@sofa/logger";

import { listBackups } from "./backup";
import { imageCacheEnabled } from "./image-cache";
import { getSetting, setSetting } from "./settings";
import { isUpdateCheckEnabled } from "./update-check";

const log = createLogger("system-health");

export interface SystemHealthData {
  database: {
    dbSizeBytes: number;
    walSizeBytes: number;
    titleCount: number;
    episodeCount: number;
    userCount: number;
  };
  tmdb: {
    connected: boolean;
    tokenValid: boolean;
    tokenConfigured: boolean;
    responseTimeMs: number | null;
    error: string | null;
  };
  jobs: {
    jobName: string;
    cronPattern: string | null;
    nextRunAt: string | null;
    lastRunAt: string | null;
    lastDurationMs: number | null;
    lastStatus: "running" | "success" | "error" | null;
    lastError: string | null;
    isCurrentlyRunning: boolean;
    disabled: boolean;
  }[];
  imageCache: {
    enabled: boolean;
    totalSizeBytes: number;
    imageCount: number;
    categories: Record<string, { count: number; sizeBytes: number }>;
  };
  backups: {
    lastBackupAt: string | null;
    lastBackupAgeHours: number | null;
    backupCount: number;
    totalSizeBytes: number;
  };
  environment: {
    dataDir: string;
    dataDirWritable: boolean;
    envVars: { name: string; value: string | null }[];
  };
  checkedAt: string;
}

const JOB_NAMES = [
  "nightlyRefreshLibrary",
  "refreshAvailability",
  "refreshRecommendations",
  "refreshTvChildren",
  "cacheImages",
  "scanEmbyLibrary",
  "scheduledBackup",
  "updateCheck",
  "checkWatchedAuthors",
  "refreshWatchedAuthorsTotalBooks",
  "watchNewAuthors",
];

async function getDatabaseHealth(): Promise<SystemHealthData["database"]> {
  let dbSizeBytes = 0;
  try {
    dbSizeBytes = await getDatabaseSizeBytes();
  } catch {}

  const counts = await getTableCounts();

  return {
    dbSizeBytes,
    // 08.10, Postgres migration: no file-based WAL to stat anymore (that
    // was SQLite-specific) - Postgres's own WAL stats need superuser
    // access this app doesn't have, so this stays 0 rather than faking a
    // number. Kept in the type/UI rather than removed since it's a minor
    // diagnostics field, not worth a wider API-shape change today.
    walSizeBytes: 0,
    ...counts,
  };
}

async function getTmdbHealth(): Promise<SystemHealthData["tmdb"]> {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN;
  if (!token) {
    return {
      connected: false,
      tokenValid: false,
      tokenConfigured: false,
      responseTimeMs: null,
      error: null,
    };
  }

  try {
    const start = performance.now();
    const res = await fetch(`${TMDB_API_BASE_URL}/configuration`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5000),
    });
    const responseTimeMs = Math.round(performance.now() - start);

    if (res.ok) {
      return {
        connected: true,
        tokenValid: true,
        tokenConfigured: true,
        responseTimeMs,
        error: null,
      };
    }

    return {
      connected: true,
      tokenValid: false,
      tokenConfigured: true,
      responseTimeMs,
      error: `HTTP ${res.status}`,
    };
  } catch (err) {
    return {
      connected: false,
      tokenValid: false,
      tokenConfigured: true,
      responseTimeMs: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

type JobSchedule = {
  jobName: string;
  pattern: string;
  nextRunAt: string | null;
};

let _getJobSchedules: (() => JobSchedule[]) | null = null;

/** Register the job schedule provider (called by the API server on startup). */
export function registerJobScheduleProvider(fn: () => JobSchedule[]) {
  _getJobSchedules = fn;
}

async function getJobsHealth(): Promise<SystemHealthData["jobs"]> {
  const schedules = _getJobSchedules?.() ?? [];
  const scheduleMap = new Map(schedules.map((s) => [s.jobName, s]));

  const [latestByJob, scheduledBackupsSetting, updateCheckEnabled] = await Promise.all([
    getLatestCronRuns([...JOB_NAMES]),
    getSetting("scheduledBackups"),
    isUpdateCheckEnabled(),
  ]);

  return JOB_NAMES.map((jobName) => {
    const latest = latestByJob.get(jobName);
    const isCurrentlyRunning = latest?.status === "running";
    const schedule = scheduleMap.get(jobName);

    // Prefer the in-memory durationMs column; fall back to timestamp diff
    let lastDurationMs: number | null = latest?.durationMs ?? null;
    if (lastDurationMs === null && latest?.finishedAt && latest.startedAt) {
      lastDurationMs = latest.finishedAt.getTime() - latest.startedAt.getTime();
    }

    const disabled =
      (jobName === "scheduledBackup" && scheduledBackupsSetting !== "true") ||
      (jobName === "updateCheck" && !updateCheckEnabled);

    return {
      jobName,
      cronPattern: disabled ? null : (schedule?.pattern ?? null),
      nextRunAt: disabled ? null : (schedule?.nextRunAt ?? null),
      lastRunAt: latest?.finishedAt?.toISOString() ?? latest?.startedAt?.toISOString() ?? null,
      lastDurationMs,
      lastStatus: (latest?.status as "running" | "success" | "error") ?? null,
      lastError: latest?.errorMessage ?? null,
      isCurrentlyRunning,
      disabled,
    };
  });
}

// Stat-ing every cached image file (123k+ files in prod across the 5
// categories below): ~830ms warm (17.08 measurement) up to ~55s on a cold
// disk cache (21.08, right after a restart). This number changes slowly
// (cache writes/evictions, not per-request), so it doesn't need to be exact
// on every page load — cached in-process for 15 minutes.
//
// 20.08: the in-process cache alone still meant every *container restart*
// paid the full scan again on the first /settings open. Fix: the last
// computed result is also persisted to appSettings (durable across
// restarts) and reloaded into the in-process cache at module init. A
// restart now serves that (possibly stale) persisted value instantly and
// refreshes it in the background instead of blocking the request.
//
// 21.08: that "background refresh" was still calling the original scan,
// which used `Bun.file(path).size` — a blocking `stat()` call, not the
// async-looking property access it appears to be — 127k+ of them back to
// back with no `await` in between held up Bun's single JS thread for the
// *entire* scan duration (same family of bug as the unbounded
// `getRecommendationsFeed`/`getContinueWatchingFeed` scans documented
// elsewhere), freezing every other request server-wide, not just whoever's
// settings page triggered it — confirmed live: a user's unrelated page
// navigation froze for the ~55s the background refresh was running.
// `computeImageCacheHealth()` now uses real async `stat()` with bounded
// concurrency (`sumFileSizes`) so the event loop stays free during the scan.
const IMAGE_CACHE_HEALTH_TTL_MS = 15 * 60 * 1000;
const IMAGE_CACHE_HEALTH_SETTING_KEY = "imageCacheHealthCache";

type ImageCacheHealthCacheEntry = { data: SystemHealthData["imageCache"]; fetchedAt: number };

let imageCacheHealthCache: ImageCacheHealthCacheEntry | null = null;
// Loaded lazily on first real use rather than at module import time — this
// module is imported (transitively) before apps/server/src/index.ts runs
// migrations, so querying appSettings at the top level could hit a
// not-yet-migrated table on a brand new database.
let imageCacheHealthLoadedFromDb = false;

async function ensurePersistedImageCacheHealthLoaded(): Promise<void> {
  if (imageCacheHealthLoadedFromDb) return;
  imageCacheHealthLoadedFromDb = true;
  try {
    const raw = await getSetting(IMAGE_CACHE_HEALTH_SETTING_KEY);
    if (raw) imageCacheHealthCache = JSON.parse(raw) as ImageCacheHealthCacheEntry;
  } catch (err) {
    log.warn("Failed to load persisted image cache health cache:", err);
  }
}

async function setImageCacheHealthCache(data: SystemHealthData["imageCache"]): Promise<void> {
  imageCacheHealthCache = { data, fetchedAt: Date.now() };
  try {
    await setSetting(IMAGE_CACHE_HEALTH_SETTING_KEY, JSON.stringify(imageCacheHealthCache));
  } catch (err) {
    log.warn("Failed to persist image cache health cache:", err);
  }
}

let imageCacheHealthRefreshInFlight = false;

function refreshImageCacheHealthInBackground(): void {
  if (imageCacheHealthRefreshInFlight) return;
  imageCacheHealthRefreshInFlight = true;
  computeImageCacheHealth()
    .then(setImageCacheHealthCache)
    .catch((err) => log.warn("Background image cache health refresh failed:", err))
    .finally(() => {
      imageCacheHealthRefreshInFlight = false;
    });
}

// 21.08: `Bun.file(path).size` looked like an async-friendly getter but is
// actually a synchronous stat() call under the hood — the previous version
// ran it 127k+ times back-to-back inside a single `.map()`, with no `await`
// between calls, so nothing yielded to the event loop for the whole scan.
// Measured on a cold disk cache: ~55s of the single JS thread doing nothing
// but this, freezing every other request server-wide (not just whoever
// triggered the scan) — the same "unbounded work blocks the one thread"
// bug family as the TVDB/recommendations issues, just hiding behind an
// innocuous-looking property access instead of an obvious loop. Fixed by
// using the genuinely async `node:fs/promises` `stat()` (goes through
// libuv's thread pool, actually yields) with bounded concurrency so the
// event loop stays free to serve other requests while this runs.
const STAT_CONCURRENCY = 64;

async function sumFileSizes(dir: string, files: string[]): Promise<number> {
  let total = 0;
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const file = files[next++];
      try {
        total += (await stat(path.join(dir, file))).size;
      } catch {
        // file removed between readdir and stat — ignore
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(STAT_CONCURRENCY, files.length) }, worker),
  );
  return total;
}

async function computeImageCacheHealth(): Promise<SystemHealthData["imageCache"]> {
  const categoryNames = ["posters", "backdrops", "stills", "logos", "profiles"];
  const categories: Record<string, { count: number; sizeBytes: number }> = {};
  let totalSizeBytes = 0;
  let imageCount = 0;

  await Promise.all(
    categoryNames.map(async (category) => {
      const dir = path.join(CACHE_DIR, category);
      try {
        const files = await readdir(dir);
        const sizeBytes = await sumFileSizes(dir, files);
        categories[category] = { count: files.length, sizeBytes };
        totalSizeBytes += sizeBytes;
        imageCount += files.length;
      } catch {
        categories[category] = { count: 0, sizeBytes: 0 };
      }
    }),
  );

  return { enabled: true, totalSizeBytes, imageCount, categories };
}

async function getImageCacheHealth(): Promise<SystemHealthData["imageCache"]> {
  const enabled = imageCacheEnabled();
  if (!enabled) {
    return { enabled: false, totalSizeBytes: 0, imageCount: 0, categories: {} };
  }

  await ensurePersistedImageCacheHealthLoaded();

  if (imageCacheHealthCache && Date.now() - imageCacheHealthCache.fetchedAt < IMAGE_CACHE_HEALTH_TTL_MS) {
    return imageCacheHealthCache.data;
  }

  // Fresh cache expired or absent this process, but a persisted (possibly
  // stale) value from a prior run is available — serve it immediately and
  // refresh for next time without blocking this request.
  if (imageCacheHealthCache) {
    refreshImageCacheHealthInBackground();
    return imageCacheHealthCache.data;
  }

  const data = await computeImageCacheHealth();
  setImageCacheHealthCache(data);
  return data;
}

async function getBackupsHealth(): Promise<SystemHealthData["backups"]> {
  try {
    const backups = await listBackups();
    const totalSizeBytes = backups.reduce((sum, b) => sum + b.sizeBytes, 0);
    const lastBackup = backups[0] ?? null;
    const lastBackupAt = lastBackup?.createdAt ?? null;
    const lastBackupAgeHours = lastBackupAt
      ? Math.round((Date.now() - new Date(lastBackupAt).getTime()) / (1000 * 60 * 60))
      : null;

    return {
      lastBackupAt,
      lastBackupAgeHours,
      backupCount: backups.length,
      totalSizeBytes,
    };
  } catch {
    return {
      lastBackupAt: null,
      lastBackupAgeHours: null,
      backupCount: 0,
      totalSizeBytes: 0,
    };
  }
}

async function getEnvironmentHealth(): Promise<SystemHealthData["environment"]> {
  const resolvedDataDir = path.resolve(DATA_DIR);
  let dataDirWritable = false;
  try {
    await access(resolvedDataDir, constants.W_OK);
    dataDirWritable = true;
  } catch {}

  const redact = (val: string | undefined): string | null => {
    if (!val) return null;
    if (val.length <= 8) return "••••••••";
    return `${val.slice(0, 4)}${"•".repeat(Math.min(val.length - 4, 24))}`;
  };

  const env = (name: string) => process.env[name] ?? null;

  return {
    dataDir: resolvedDataDir,
    dataDirWritable,
    envVars: [
      // Core
      { name: "DATA_DIR", value: resolvedDataDir },
      { name: "LOG_LEVEL", value: env("LOG_LEVEL") ?? "info" },
      // Auth
      { name: "BETTER_AUTH_URL", value: env("BETTER_AUTH_URL") },
      {
        name: "BETTER_AUTH_SECRET",
        value: redact(env("BETTER_AUTH_SECRET") ?? undefined),
      },
      // TMDB
      {
        name: "TMDB_API_READ_ACCESS_TOKEN",
        value: redact(env("TMDB_API_READ_ACCESS_TOKEN") ?? undefined),
      },
      { name: "TMDB_API_BASE_URL", value: env("TMDB_API_BASE_URL") },
      { name: "TMDB_IMAGE_BASE_URL", value: env("TMDB_IMAGE_BASE_URL") },
      // Image cache
      {
        name: "IMAGE_CACHE_ENABLED",
        value: env("IMAGE_CACHE_ENABLED") ?? "true",
      },
      // OIDC
      { name: "OIDC_ISSUER_URL", value: env("OIDC_ISSUER_URL") },
      { name: "OIDC_CLIENT_ID", value: env("OIDC_CLIENT_ID") },
      {
        name: "OIDC_CLIENT_SECRET",
        value: redact(env("OIDC_CLIENT_SECRET") ?? undefined),
      },
      { name: "OIDC_PROVIDER_NAME", value: env("OIDC_PROVIDER_NAME") },
      { name: "OIDC_AUTO_REGISTER", value: env("OIDC_AUTO_REGISTER") },
      { name: "DISABLE_PASSWORD_LOGIN", value: env("DISABLE_PASSWORD_LOGIN") },
    ],
  };
}

export async function getSystemHealth(): Promise<SystemHealthData> {
  const [database, tmdb, jobs, imageCache, backups, environment] = await Promise.all([
    getDatabaseHealth(),
    getTmdbHealth(),
    getJobsHealth(),
    getImageCacheHealth(),
    getBackupsHealth(),
    getEnvironmentHealth(),
  ]);

  return {
    database,
    tmdb,
    jobs,
    imageCache,
    backups,
    environment,
    checkedAt: new Date().toISOString(),
  };
}
