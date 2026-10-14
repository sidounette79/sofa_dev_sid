import { access, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { ORPCError } from "@orpc/server";

import { AppErrorCode } from "@sofa/api/errors";
import { BACKUP_DIR } from "@sofa/config";
import {
  createBackup,
  deleteBackup,
  ensureBackupDir,
  listBackups,
  restoreFromBackup,
} from "@sofa/core/backup";
import {
  purgeImageCache as purgeImagesFn,
  purgeMetadataCache as purgeMetadataFn,
} from "@sofa/core/cache";
import { getSetting, getSettings, setSetting } from "@sofa/core/settings";
import { getSystemHealth } from "@sofa/core/system-health";
import { getCachedUpdateCheck } from "@sofa/core/update-check";

import { pauseJobs, rescheduleBackup, resumeJobs, triggerJob as triggerCronJob } from "../../cron";
import { os } from "../context";
import { admin } from "../middleware";

// ─── Settings (consolidated) ──────────────────────────────────

export const settingsGet = os.admin.settings.get.use(admin).handler(async () => {
  // Batch all appSettings lookups for this panel into a single query
  // instead of one round-trip per key.
  const settings = await getSettings(["registrationOpen", "updateCheckEnabled"]);
  const updateCheckEnabled = settings.updateCheckEnabled !== "false";
  const check = updateCheckEnabled ? await getCachedUpdateCheck() : null;

  return {
    registration: {
      open: settings.registrationOpen === "true",
    },
    updateCheck: {
      enabled: updateCheckEnabled,
      updateAvailable: check?.updateAvailable ?? null,
      currentVersion: check?.currentVersion ?? null,
      latestVersion: check?.latestVersion ?? null,
      releaseUrl: check?.releaseUrl ?? null,
      lastCheckedAt: check?.lastCheckedAt ?? null,
    },
  };
});

export const settingsUpdate = os.admin.settings.update.use(admin).handler(async ({ input }) => {
  if (input.registration) {
    await setSetting("registrationOpen", String(input.registration.open));
  }
  if (input.updateCheck) {
    await setSetting("updateCheckEnabled", String(input.updateCheck.enabled));
  }
});

// ─── Backups ──────────────────────────────────────────────────

export const backupsList = os.admin.backups.list.use(admin).handler(async () => {
  const backups = await listBackups();
  return { backups };
});

export const backupsCreate = os.admin.backups.create.use(admin).handler(async () => {
  return await createBackup();
});

export const backupsDelete = os.admin.backups.delete.use(admin).handler(async ({ input }) => {
  await deleteBackup(input.filename);
});

export const backupsRestore = os.admin.backups.restore
  .use(admin)
  .handler(async ({ input: file }) => {
    await ensureBackupDir();
    const tmpPath = path.join(BACKUP_DIR, `.upload-${Date.now()}-${crypto.randomUUID()}.db`);
    pauseJobs();
    try {
      await writeFile(tmpPath, Buffer.from(await file.arrayBuffer()));
      await restoreFromBackup(tmpPath);
    } catch (err) {
      try {
        await access(tmpPath);
        await unlink(tmpPath);
      } catch {
        // Nothing to clean up
      }
      if (err instanceof ORPCError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new ORPCError("BAD_REQUEST", {
        message: msg,
        data: { code: AppErrorCode.BACKUP_RESTORE_FAILED },
      });
    } finally {
      resumeJobs();
    }
  });

export const backupsSchedule = os.admin.backups.schedule.use(admin).handler(async () => {
  const [enabled, maxRetention, frequency, time, dayOfWeek] = await Promise.all([
    getSetting("scheduledBackups"),
    getSetting("maxBackupRetention"),
    getSetting("backupScheduleFrequency"),
    getSetting("backupScheduleTime"),
    getSetting("backupScheduleDow"),
  ]);
  return {
    enabled: enabled === "true",
    maxRetention: Number.parseInt(maxRetention ?? "7", 10),
    frequency: (frequency ?? "1d") as "6h" | "12h" | "1d" | "7d",
    time: time ?? "02:00",
    dayOfWeek: Number.parseInt(dayOfWeek ?? "0", 10),
  };
});

export const backupsUpdateSchedule = os.admin.backups.updateSchedule
  .use(admin)
  .handler(async ({ input }) => {
    if (input.enabled !== undefined) await setSetting("scheduledBackups", String(input.enabled));
    if (input.frequency !== undefined)
      await setSetting("backupScheduleFrequency", input.frequency);
    if (input.time !== undefined) await setSetting("backupScheduleTime", input.time);
    if (input.dayOfWeek !== undefined)
      await setSetting("backupScheduleDow", String(input.dayOfWeek));
    if (input.maxRetention !== undefined)
      await setSetting("maxBackupRetention", String(input.maxRetention));

    if (input.frequency || input.time || input.dayOfWeek !== undefined) {
      await rescheduleBackup();
    }
  });

// ─── Jobs ─────────────────────────────────────────────────────

export const triggerJob = os.admin.triggerJob.use(admin).handler(async ({ input }) => {
  const triggered = await triggerCronJob(input.name);
  if (!triggered) {
    throw new ORPCError("NOT_FOUND", {
      message: "Job not found",
      data: { code: AppErrorCode.JOB_NOT_FOUND },
    });
  }
  return { ok: true as const };
});

// ─── Purge ────────────────────────────────────────────────────

export const purgeMetadataCache = os.admin.purgeMetadataCache
  .use(admin)
  .handler(() => purgeMetadataFn());

export const purgeImageCache = os.admin.purgeImageCache
  .use(admin)
  .handler(async () => purgeImagesFn());

// ─── System Health ────────────────────────────────────────────

export const systemHealth = os.admin.systemHealth.use(admin).handler(async () => {
  return await getSystemHealth();
});
