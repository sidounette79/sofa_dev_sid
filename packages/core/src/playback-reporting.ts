/*
 * 02.09, Sid — "Tautulli est le seul truc que je regrette de Plex... Emby
 * n'a jamais eu un truc vraiment bien" pour ses propres stats de lecture,
 * et "quand je nettoie les trucs vus je suis obligée d'aller sur chaque
 * compte pour voir ce qui a été vu". Emby's "Playback Reporting" plugin
 * (already installed on her server, v2.1.0.7 — confirmed via /Plugins)
 * keeps exactly this: a flat, cross-account history of every playback
 * session, in its own SQLite table queryable through a plugin endpoint.
 * This is deliberately independent of Sofa's own per-user tracking (her
 * explicit ask) — real Emby accounts and real Emby history, not filtered
 * through which Sofa user has an integration linked.
 */
import { EMBY_ADMIN_USER_ID, EMBY_API_KEY, EMBY_EXCLUDED_LIBRARY_IDS, EMBY_URL } from "@sofa/config";

import { embyFetch, getEmbyNowPlaying } from "./emby";
import type { EmbyNowPlayingSession } from "./emby";

interface CustomQueryResult {
  colums: string[];
  results: string[][];
  message: string;
}

async function runPlaybackReportQuery(query: string): Promise<CustomQueryResult> {
  if (!EMBY_URL || !EMBY_API_KEY) {
    throw new Error("Emby is not configured");
  }
  const res = await fetch(`${EMBY_URL}/user_usage_stats/submit_custom_query`, {
    method: "POST",
    headers: { "X-Emby-Token": EMBY_API_KEY, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new Error(`Emby API error: ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<CustomQueryResult>;
}

// The plugin endpoint takes a raw SQL string with no parameter binding —
// admin-only surface, but still worth defending: only real Emby user IDs
// (validated against a live /Users fetch, never trusted as-is from the
// request) and a narrowly escaped search string ever reach the query.
function escapeSqlString(value: string): string {
  return value.replace(/'/g, "''");
}

interface EmbyUser {
  Id: string;
  Name: string;
}

export interface PlaybackActivityItem {
  date: string;
  userId: string;
  userName: string;
  itemName: string;
  itemType: string;
  deviceName: string;
  clientName: string;
  playDurationSeconds: number;
}

export interface PlaybackActivityFilters {
  limit: number;
  offset: number;
  userId?: string;
  search?: string;
}

export async function getPlaybackActivity(
  filters: PlaybackActivityFilters,
): Promise<{ items: PlaybackActivityItem[]; total: number }> {
  const users = await embyFetch<EmbyUser[]>("/Users");
  const userNameById = new Map(users.map((u) => [u.Id, u.Name] as const));
  const validUserIds = new Set(users.map((u) => u.Id));

  const whereClauses: string[] = [];
  if (filters.userId && validUserIds.has(filters.userId)) {
    whereClauses.push(`UserId = '${filters.userId}'`);
  }
  if (filters.search) {
    // Alphanumeric/space/basic punctuation only — real titles can contain
    // apostrophes etc. (escaped above), but this also strips SQL comment
    // sequences and stray quotes/semicolons a title would never contain.
    const cleaned = filters.search.replace(/[^\p{L}\p{N}\s'".,!?:()-]/gu, "");
    whereClauses.push(`ItemName LIKE '%${escapeSqlString(cleaned)}%'`);
  }
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const limit = Math.min(Math.max(filters.limit, 1), 200);
  const offset = Math.max(filters.offset, 0);

  const [countResult, rowsResult] = await Promise.all([
    runPlaybackReportQuery(`SELECT COUNT(*) FROM PlaybackActivity ${whereSql}`),
    runPlaybackReportQuery(
      `SELECT DateCreated, UserId, ItemName, ItemType, DeviceName, ClientName, PlayDuration ` +
        `FROM PlaybackActivity ${whereSql} ORDER BY DateCreated DESC LIMIT ${limit} OFFSET ${offset}`,
    ),
  ]);

  const total = Number(countResult.results[0]?.[0] ?? 0);
  const items: PlaybackActivityItem[] = rowsResult.results.map((row) => {
    const [date, userId, itemName, itemType, deviceName, clientName, playDuration] = row;
    return {
      date: date ?? "",
      userId: userId ?? "",
      userName: userNameById.get(userId ?? "") ?? (userId ?? "?"),
      itemName: itemName ?? "",
      itemType: itemType ?? "",
      deviceName: deviceName ?? "",
      clientName: clientName ?? "",
      playDurationSeconds: Number(playDuration ?? 0),
    };
  });

  return { items, total };
}

export interface PlaybackReportingUser {
  userId: string;
  userName: string;
}

/** Real Emby accounts that have at least one logged session — the filter
 * dropdown's options, not the full /Users list (some Emby accounts, like
 * service/bot accounts, never actually play anything). */
export async function listUsersWithActivity(): Promise<PlaybackReportingUser[]> {
  const [users, distinctUsers] = await Promise.all([
    embyFetch<EmbyUser[]>("/Users"),
    runPlaybackReportQuery("SELECT DISTINCT UserId FROM PlaybackActivity"),
  ]);
  const userNameById = new Map(users.map((u) => [u.Id, u.Name] as const));
  return distinctUsers.results
    .map((row) => row[0])
    .filter((id): id is string => id !== undefined && userNameById.has(id))
    .map((id) => ({ userId: id, userName: userNameById.get(id)! }));
}

// 02.09, Sid — "on met les deux": the library-breakdown + active-streams
// idea came from looking at a since-abandoned Discord bot ("EmbyWatch")
// she'd found; its actual code turned out to have nothing for playback
// *history* (the whole point of this page), only a live status view — this
// replicates just that part, not by copying its genre-guessing (built for
// a differently-organized server), just her own real libraries as-is.
interface EmbyView {
  Id: string;
  Name: string;
  CollectionType?: string;
}

export interface LibraryOverviewItem {
  id: string;
  name: string;
  collectionType: string | null;
  itemCount: number;
}

export async function getLibraryOverview(): Promise<LibraryOverviewItem[]> {
  if (!EMBY_ADMIN_USER_ID) return [];
  const viewsResponse = await embyFetch<{ Items: EmbyView[] }>(
    `/Users/${EMBY_ADMIN_USER_ID}/Views`,
  );
  const views = viewsResponse.Items.filter((v) => !EMBY_EXCLUDED_LIBRARY_IDS.includes(v.Id));

  return Promise.all(
    views.map(async (view) => {
      const result = await embyFetch<{ TotalRecordCount: number }>(
        `/Users/${EMBY_ADMIN_USER_ID}/Items?ParentId=${view.Id}&Recursive=true&Limit=0`,
      );
      return {
        id: view.Id,
        name: view.Name,
        collectionType: view.CollectionType ?? null,
        itemCount: result.TotalRecordCount,
      };
    }),
  );
}

export async function getActiveStreams(): Promise<EmbyNowPlayingSession[]> {
  return getEmbyNowPlaying();
}
