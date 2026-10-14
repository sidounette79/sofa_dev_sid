import webpush from "web-push";

import { getFollowingUserIds } from "@sofa/db/queries/notifications";
import {
  deletePushSubscriptionsByEndpoints,
  getPushSubscriptionsForUsers,
} from "@sofa/db/queries/push";
import { VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT } from "@sofa/config";
import { createLogger } from "@sofa/logger";

const log = createLogger("push");

const configured = Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
if (configured) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY!, VAPID_PRIVATE_KEY!);
} else {
  log.warn("VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push notifications are disabled");
}

export function isPushConfigured(): boolean {
  return configured;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

/**
 * Sends one push message to every subscription belonging to `userIds`
 * (a user with two devices gets two pushes). A subscription whose push
 * service reports it gone (404/410 — browser unsubscribed, uninstalled the
 * app, etc.) is deleted right away rather than retried; any other failure
 * (network blip, transient 5xx) is just logged, the subscription stays.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!configured || userIds.length === 0) return;

  const subscriptions = await getPushSubscriptionsForUsers(userIds);
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);
  const gone: string[] = [];

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          gone.push(sub.endpoint);
        } else {
          log.warn(`Push send failed for endpoint ${sub.endpoint}:`, err);
        }
      }
    }),
  );

  if (gone.length > 0) {
    await deletePushSubscriptionsByEndpoints(gone);
    log.debug(`Pruned ${gone.length} expired push subscription(s)`);
  }
}

// TMDB's raw TV `status` values, translated for the notification body — not
// covered by the app's own i18n catalog since nothing displayed this as a
// standalone sentence before (existing UI just shows an icon + the raw
// English string as a tooltip, see title-hero.tsx).
const TV_STATUS_LABELS_FR: Record<string, string> = {
  "Returning Series": "en cours",
  "In Production": "en cours de production",
  Planned: "prévue",
  Pilot: "pilote",
  Ended: "terminée",
  Canceled: "annulée",
};

function formatTvStatusFr(status: string): string {
  return TV_STATUS_LABELS_FR[status] ?? status;
}

/** Fires from `refreshTitle` (packages/core/src/metadata.ts) whenever a
 * nightly/on-demand TMDB refresh finds a TV show's `status` changed since
 * the last fetch — only to users actively following it (watching or on
 * their watchlist, see getFollowingUserIds). */
export async function notifySeriesStatusChanged(
  titleId: string,
  titleName: string,
  oldStatus: string,
  newStatus: string,
): Promise<void> {
  const userIds = await getFollowingUserIds(titleId);
  if (userIds.length === 0) return;
  await sendPushToUsers(userIds, {
    title: titleName,
    body: `Passée de « ${formatTvStatusFr(oldStatus)} » à « ${formatTvStatusFr(newStatus)} »`,
    url: `/titles/${titleId}`,
  });
}

/** 04.09, Sid — "pas mal" to know when a request actually lands, not just
 * that it aired/changed status (see notifyEpisodeReleased/notifySeriesStatusChanged
 * above, which fire on TMDB calendar events, not on real availability).
 * Fires from the Emby library scan (packages/core/src/emby-library.ts) the
 * moment a title flips to "in library" for the first time — real-time via
 * the per-item webhook path, plus the periodic full scan as a safety net for
 * a missed webhook (same reconciliation pattern as elsewhere in this app).
 * Only titles requested through Sofa's own "Demande" button carry a
 * requestedByUserId — one reconciled from an existing Radarr/Sonarr request
 * has none (see markTitlesRequested), so there's nobody to notify and this
 * simply never fires for those. */
export async function notifyRequestAvailable(
  userId: string,
  titleId: string,
  titleName: string,
): Promise<void> {
  await sendPushToUsers([userId], {
    title: titleName,
    body: "Ta demande est maintenant disponible",
    url: `/titles/${titleId}`,
  });
}

/** Fires from the notifyNewEpisodes cron (packages/core/src/cron.ts) for
 * every episode airing today, to users actively following that show. */
export async function notifyEpisodeReleased(
  titleId: string,
  titleName: string,
  seasonNumber: number,
  episodeNumber: number,
  episodeName: string | null,
): Promise<void> {
  const userIds = await getFollowingUserIds(titleId);
  if (userIds.length === 0) return;
  const code = `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}`;
  await sendPushToUsers(userIds, {
    title: titleName,
    body: `${code}${episodeName ? ` · ${episodeName}` : ""} vient de sortir`,
    url: `/titles/${titleId}`,
  });
}
