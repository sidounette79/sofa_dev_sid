/*
 * 01.09, Sid — "Lire sur..." : elle choisit quoi regarder dans Sofa, mais
 * lance depuis l'appli Emby elle-même pour que ça joue sur la bonne TV (pas
 * son téléphone). Ce module s'appuie sur l'API "remote control" d'Emby —
 * le même mécanisme que les apps Emby officielles utilisent pour caster
 * entre appareils connectés au même compte, sans Chromecast — pour lancer
 * la lecture directement sur l'appli Emby native d'un autre appareil
 * (ex. la TV du salon) depuis Sofa.
 *
 * Chaque compte Emby du foyer peut avoir des dizaines d'appareils
 * enregistrés (tous les téléphones/tablettes/TV jamais connectés, tout le
 * monde confondu) — `userPlaybackDevices` (packages/db) garde la
 * sélection de 2-3 appareils que CET utilisateur Sofa veut voir dans son
 * propre picker, pas la liste complète du foyer.
 */
import {
  dismissDeviceForUser,
  getDismissedDeviceIdsForUser,
  getEpisodeEmbyItemId,
  getFavoriteDevicesForUser,
  getTitleEmbyItemId,
  replaceFavoriteDevicesForUser,
} from "@sofa/db/queries/playback-devices";
import { getIntegrationByUserAndProvider } from "@sofa/db/queries/integrations";

import { embyFetch, embyPost, getEmbyUserIdsByUsername } from "./emby";

export class PlaybackDeviceError extends Error {}

interface EmbyDeviceRaw {
  Id: string;
  Name: string;
  ReportedDeviceId: string;
  AppName: string;
  IconUrl?: string;
  LastUserId?: string;
  DateLastActivity?: string;
}

interface EmbySessionRaw {
  Id: string;
  UserId?: string;
  DeviceId?: string;
  NowPlayingItem?: { Name: string };
}

async function resolveEmbyUserId(sofaUserId: string): Promise<string | null> {
  const [integration] = await getIntegrationByUserAndProvider(sofaUserId, "emby");
  if (!integration?.embyUsername) return null;
  const usersByName = await getEmbyUserIdsByUsername();
  return usersByName.get(integration.embyUsername.toLowerCase()) ?? null;
}

export interface AvailableDevice {
  embyDeviceId: string;
  embyDeviceName: string;
  appName: string;
  iconUrl: string | null;
  lastActivityAt: string | null;
}

// 01.09, Sid: "on lance pas la lecture sur le navigateur" — a browser tab
// can technically receive a remote-play command too, but she never wants
// to cast to one, and neither would anyone else in the house. Universal,
// not per-user, on purpose.
const NON_PLAYBACK_APP_NAMES = new Set(["Emby Web"]);

/** Every device this Sofa user's own Emby account has ever connected
 * with, minus browser sessions (never a real cast target) and whatever
 * this user has explicitly dismissed — the pool the favorites picker
 * (settings) chooses a handful from. Her own account alone had 57 devices
 * going back over a year (every phone/tablet/TV/request-bot that's ever
 * connected) before dismissals. */
export async function listAvailableDevices(sofaUserId: string): Promise<AvailableDevice[]> {
  const embyUserId = await resolveEmbyUserId(sofaUserId);
  if (!embyUserId) return [];
  const dismissed = await getDismissedDeviceIdsForUser(sofaUserId);
  const response = await embyFetch<{ Items: EmbyDeviceRaw[] }>("/Devices");
  return response.Items.filter(
    (d) =>
      d.LastUserId === embyUserId &&
      !NON_PLAYBACK_APP_NAMES.has(d.AppName) &&
      !dismissed.has(d.ReportedDeviceId),
  ).map((d) => ({
    embyDeviceId: d.ReportedDeviceId,
    embyDeviceName: d.Name,
    appName: d.AppName,
    iconUrl: d.IconUrl ?? null,
    lastActivityAt: d.DateLastActivity ?? null,
  }));
}

export function dismissDevice(sofaUserId: string, embyDeviceId: string): Promise<void> {
  return dismissDeviceForUser(sofaUserId, embyDeviceId);
}

export interface FavoriteDevice {
  embyDeviceId: string;
  embyDeviceName: string;
  online: boolean;
  nowPlaying: string | null;
}

/** This user's saved shortlist, cross-referenced against Emby's currently
 * active sessions so the "Lire sur..." picker can show which ones are
 * actually reachable right now (a device only has a live session while its
 * Emby app is open/connected — being "known" and being "online" are
 * different things). */
export async function listFavoriteDevices(sofaUserId: string): Promise<FavoriteDevice[]> {
  const favorites = await getFavoriteDevicesForUser(sofaUserId);
  if (favorites.length === 0) return [];

  const embyUserId = await resolveEmbyUserId(sofaUserId);
  const sessionByDeviceId = new Map<string, EmbySessionRaw>();
  if (embyUserId) {
    try {
      const sessions = await embyFetch<EmbySessionRaw[]>("/Sessions?ActiveWithinSeconds=960");
      for (const session of sessions) {
        if (session.UserId === embyUserId && session.DeviceId) {
          sessionByDeviceId.set(session.DeviceId, session);
        }
      }
    } catch {
      // Emby unreachable — fall through with everything shown offline
      // rather than failing the whole picker.
    }
  }

  return favorites.map((fav) => {
    const session = sessionByDeviceId.get(fav.embyDeviceId);
    return {
      embyDeviceId: fav.embyDeviceId,
      embyDeviceName: fav.embyDeviceName,
      online: session !== undefined,
      nowPlaying: session?.NowPlayingItem?.Name ?? null,
    };
  });
}

export function setFavoriteDevices(
  sofaUserId: string,
  devices: { embyDeviceId: string; embyDeviceName: string }[],
): Promise<void> {
  return replaceFavoriteDevicesForUser(sofaUserId, devices);
}

/** Sends a movie/episode straight to another Emby session's native app —
 * the "Lire sur..." action itself. Throws PlaybackDeviceError (not found —
 * never connected/authorized to this account — or currently offline —
 * app closed right now) rather than silently no-op-ing, since both are
 * real, actionable states the UI needs to tell Sid about. */
export async function playOnDevice(
  sofaUserId: string,
  embyDeviceId: string,
  target: { titleId: string } | { episodeId: string },
): Promise<void> {
  const embyItemId =
    "titleId" in target
      ? await getTitleEmbyItemId(target.titleId)
      : await getEpisodeEmbyItemId(target.episodeId);
  if (!embyItemId) {
    throw new PlaybackDeviceError("This title isn't linked to an Emby item yet");
  }

  const embyUserId = await resolveEmbyUserId(sofaUserId);
  if (!embyUserId) {
    throw new PlaybackDeviceError("No linked Emby account for this user");
  }

  const sessions = await embyFetch<EmbySessionRaw[]>("/Sessions?ActiveWithinSeconds=960");
  const session = sessions.find((s) => s.UserId === embyUserId && s.DeviceId === embyDeviceId);
  if (!session) {
    throw new PlaybackDeviceError("This device isn't currently online in Emby");
  }

  await embyPost(
    `/Sessions/${session.Id}/Playing?ItemIds=${encodeURIComponent(embyItemId)}&PlayCommand=PlayNow`,
  );
}
