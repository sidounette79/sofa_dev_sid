import { and, eq } from "drizzle-orm";

import { db } from "../client";
import { episodes, titles, userDismissedPlaybackDevices, userPlaybackDevices } from "../schema";

export function getFavoriteDevicesForUser(userId: string) {
  return db
    .select({
      embyDeviceId: userPlaybackDevices.embyDeviceId,
      embyDeviceName: userPlaybackDevices.embyDeviceName,
    })
    .from(userPlaybackDevices)
    .where(eq(userPlaybackDevices.userId, userId));
}

/** Replace-all — the picker UI always submits the full desired list (2-3
 * devices), simpler than diffing adds/removes for a list this small. */
export async function replaceFavoriteDevicesForUser(
  userId: string,
  devices: { embyDeviceId: string; embyDeviceName: string }[],
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.delete(userPlaybackDevices).where(eq(userPlaybackDevices.userId, userId));
    if (devices.length > 0) {
      await tx.insert(userPlaybackDevices).values(
        devices.map((device) => ({
          userId,
          embyDeviceId: device.embyDeviceId,
          embyDeviceName: device.embyDeviceName,
          createdAt: now,
        })),
      );
    }
  });
}

export async function getTitleEmbyItemId(titleId: string): Promise<string | null> {
  const [row] = await db
    .select({ embyItemId: titles.embyItemId })
    .from(titles)
    .where(eq(titles.id, titleId));
  return row?.embyItemId ?? null;
}

export async function getEpisodeEmbyItemId(episodeId: string): Promise<string | null> {
  const [row] = await db
    .select({ embyItemId: episodes.embyItemId })
    .from(episodes)
    .where(eq(episodes.id, episodeId));
  return row?.embyItemId ?? null;
}

export async function getDismissedDeviceIdsForUser(userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ embyDeviceId: userDismissedPlaybackDevices.embyDeviceId })
    .from(userDismissedPlaybackDevices)
    .where(eq(userDismissedPlaybackDevices.userId, userId));
  return new Set(rows.map((r) => r.embyDeviceId));
}

export async function dismissDeviceForUser(userId: string, embyDeviceId: string): Promise<void> {
  await db
    .insert(userDismissedPlaybackDevices)
    .values({ userId, embyDeviceId, createdAt: new Date() })
    .onConflictDoNothing();
}

export async function undismissDeviceForUser(userId: string, embyDeviceId: string): Promise<void> {
  await db
    .delete(userDismissedPlaybackDevices)
    .where(
      and(
        eq(userDismissedPlaybackDevices.userId, userId),
        eq(userDismissedPlaybackDevices.embyDeviceId, embyDeviceId),
      ),
    );
}
