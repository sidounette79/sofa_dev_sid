import { EMBY_ADMIN_USER_ID, EMBY_EXCLUDED_LIBRARY_IDS } from "@sofa/config";
import {
  clearSingleEmbyLibraryFlag,
  clearStaleEmbyLibraryFlags,
  getEmbyLibraryOwnersMap,
  getUserEmbyLibraries,
  markTitlesInEmbyLibrary,
  setUserEmbyLibraries,
} from "@sofa/db/queries/emby-library";
import {
  getSeasonsForTitle,
  setEpisodeEmbyItemIds,
  updateTitleFields,
} from "@sofa/db/queries/metadata";
import { getTitleById } from "@sofa/db/queries/title";
import { createLogger } from "@sofa/logger";

import { embyFetch } from "./emby";
import { resolveMovieTmdbId, resolveShowTmdbId } from "./imports/resolve";
import { ensureBrowseTitlesExist } from "./metadata";
import { notifyRequestAvailable } from "./push";
import { quickAddTitle } from "./tracking";

/** A title that just flipped to "in library" for the first time, requested
 * through Sofa's own button (so there's a real user to notify) — see the
 * doc comment on notifyRequestAvailable (push.ts). */
function notifyIfRequestNowAvailable(
  before: { inEmbyLibrary: boolean; requestedByUserId: string | null; title: string } | undefined,
  titleId: string,
): void {
  if (!before || before.inEmbyLibrary || !before.requestedByUserId) return;
  notifyRequestAvailable(before.requestedByUserId, titleId, before.title).catch((err) =>
    log.warn(`Failed to send request-available notification for title ${titleId}:`, err),
  );
}

const log = createLogger("emby-library");

interface EmbyView {
  Id: string;
  Name: string;
  CollectionType?: string;
}

interface EmbyLibraryItem {
  Id: string;
  Name: string;
  Type: string;
  ProductionYear?: number;
  ProviderIds?: Record<string, string>;
  // 25.08, Sid: her Emby server already has a correct French synopsis for
  // titles TMDB only returns in English (found live: "Babygirl" — French on
  // Emby, English in Sofa). The TV side already had this via TVDB episode/
  // series translations; movies never did. Reusing Emby's own Overview here
  // covers both movies and series in one pass, and is more reliable than a
  // second TMDB translations round-trip — if it shows correctly in her Emby,
  // it's already known-good for her actual server/library language config.
  Overview?: string;
}

interface EmbyItemsPage {
  Items: EmbyLibraryItem[];
  TotalRecordCount: number;
}

async function getScannableLibraries(): Promise<EmbyView[]> {
  if (!EMBY_ADMIN_USER_ID) return [];
  const result = await embyFetch<{ Items: EmbyView[] }>(`/Users/${EMBY_ADMIN_USER_ID}/Views`);
  return result.Items.filter((v) => !EMBY_EXCLUDED_LIBRARY_IDS.includes(v.Id));
}

async function fetchLibraryItems(libraryId: string): Promise<EmbyLibraryItem[]> {
  const items: EmbyLibraryItem[] = [];
  const pageSize = 200;
  let startIndex = 0;

  for (;;) {
    const page = await embyFetch<EmbyItemsPage>(
      `/Users/${EMBY_ADMIN_USER_ID}/Items?ParentId=${libraryId}&Recursive=true` +
        `&IncludeItemTypes=Movie,Series&Fields=ProviderIds,ProductionYear,Overview` +
        `&StartIndex=${startIndex}&Limit=${pageSize}`,
    );
    items.push(...page.Items);
    startIndex += page.Items.length;
    if (page.Items.length < pageSize || startIndex >= page.TotalRecordCount) break;
  }

  return items;
}

interface EmbyEpisodeItem {
  Id: string;
  ParentIndexNumber?: number;
  IndexNumber?: number;
}

async function fetchSeriesEpisodes(seriesId: string): Promise<EmbyEpisodeItem[]> {
  try {
    const result = await embyFetch<{ Items: EmbyEpisodeItem[] }>(
      `/Shows/${seriesId}/Episodes?UserId=${EMBY_ADMIN_USER_ID}&Fields=ParentIndexNumber,IndexNumber`,
    );
    return result.Items;
  } catch (err) {
    log.warn(`Failed to fetch episodes for series ${seriesId}:`, err);
    return [];
  }
}

async function syncSeriesEpisodeEmbyIds(titleId: string, seriesId: string): Promise<void> {
  const embyEpisodes = await fetchSeriesEpisodes(seriesId);
  if (embyEpisodes.length === 0) return;

  const seasonsForTitle = await getSeasonsForTitle(titleId);
  const seasonIdByNumber = new Map(seasonsForTitle.map((s) => [s.seasonNumber, s.id]));

  const updates = embyEpisodes
    .map((ep) => {
      if (ep.ParentIndexNumber == null || ep.IndexNumber == null) return null;
      const seasonId = seasonIdByNumber.get(ep.ParentIndexNumber);
      if (!seasonId) return null;
      return { seasonId, episodeNumber: ep.IndexNumber, embyItemId: ep.Id };
    })
    .filter((u): u is NonNullable<typeof u> => u !== null);

  await setEpisodeEmbyItemIds(updates);
}

async function resolveItemTmdbId(item: EmbyLibraryItem): Promise<number | null> {
  const providerIds = item.ProviderIds ?? {};
  if (providerIds.Tmdb) return Number(providerIds.Tmdb);

  const ids = {
    tvdbId: providerIds.Tvdb,
    imdbId: providerIds.Imdb,
    title: item.Name,
    year: item.ProductionYear,
  };

  return item.Type === "Movie" ? resolveMovieTmdbId(ids) : resolveShowTmdbId(ids);
}

export interface EmbyLibraryScanResult {
  librariesScanned: number;
  itemsSeen: number;
  matched: number;
  unresolved: number;
  clearedStale: number;
  autoTracked: number;
}

export async function scanEmbyLibrary(): Promise<EmbyLibraryScanResult> {
  if (!EMBY_ADMIN_USER_ID) {
    log.debug("EMBY_ADMIN_USER_ID not configured, skipping library scan");
    return {
      librariesScanned: 0,
      itemsSeen: 0,
      matched: 0,
      unresolved: 0,
      clearedStale: 0,
      autoTracked: 0,
    };
  }

  const libraries = await getScannableLibraries();
  const libraryOwners = await getEmbyLibraryOwnersMap();
  const seenEmbyItemIds: string[] = [];
  let itemsSeen = 0;
  let unresolved = 0;
  let autoTracked = 0;

  for (const library of libraries) {
    let items: EmbyLibraryItem[];
    try {
      items = await fetchLibraryItems(library.Id);
    } catch (err) {
      log.warn(`Failed to fetch items for library "${library.Name}":`, err);
      continue;
    }

    itemsSeen += items.length;

    const resolved: { item: EmbyLibraryItem; tmdbId: number; type: "movie" | "tv" }[] = [];
    for (const item of items) {
      const tmdbId = await resolveItemTmdbId(item);
      if (tmdbId) {
        resolved.push({ item, tmdbId, type: item.Type === "Movie" ? "movie" : "tv" });
        seenEmbyItemIds.push(item.Id);
      } else {
        unresolved++;
        log.debug(`Could not resolve TMDB ID for "${item.Name}" in "${library.Name}"`);
      }
    }

    if (resolved.length === 0) continue;

    const titleMap = await ensureBrowseTitlesExist(
      resolved.map((r) => ({
        tmdbId: r.tmdbId,
        type: r.type,
        title: r.item.Name,
        posterPath: null,
      })),
    );

    const matches = resolved
      .map((r) => {
        const entry = titleMap.get(`${r.tmdbId}-${r.type}`);
        if (!entry) return null;
        return {
          titleId: entry.id,
          embyItemId: r.item.Id,
          embyLibraryName: library.Name,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    const preScanStates = new Map(
      await Promise.all(
        matches.map(async (m) => [m.titleId, (await getTitleById(m.titleId))[0]] as const),
      ),
    );

    await markTitlesInEmbyLibrary(matches);
    log.debug(`Library "${library.Name}": ${matches.length}/${items.length} matched`);

    for (const match of matches) {
      notifyIfRequestNowAvailable(preScanStates.get(match.titleId), match.titleId);
    }

    for (const r of resolved) {
      const overview = r.item.Overview?.trim();
      if (!overview) continue;
      const entry = titleMap.get(`${r.tmdbId}-${r.type}`);
      if (!entry) continue;
      await updateTitleFields(entry.id, { overviewFr: overview });
    }

    // For TV series, also sync episode-level Emby IDs (used for deep-linking
    // to the next unwatched episode rather than just the series root).
    for (const r of resolved) {
      if (r.type !== "tv") continue;
      const entry = titleMap.get(`${r.tmdbId}-tv`);
      if (!entry) continue;
      await syncSeriesEpisodeEmbyIds(entry.id, r.item.Id);
    }

    // Auto-track for any Sofa user who has claimed this Emby library as theirs,
    // same effect as clicking "+" on the title (quickAddTitle no-ops if already tracked).
    const owners = libraryOwners.get(library.Name);
    if (owners && owners.length > 0) {
      for (const match of matches) {
        for (const userId of owners) {
          const result = await quickAddTitle(userId, match.titleId);
          if (result && !result.alreadyAdded) autoTracked++;
        }
      }
    }
  }

  const clearedStale = await clearStaleEmbyLibraryFlags(seenEmbyItemIds);

  const result = {
    librariesScanned: libraries.length,
    itemsSeen,
    matched: seenEmbyItemIds.length,
    unresolved,
    clearedStale,
    autoTracked,
  };
  log.info(
    `Emby library scan: ${result.librariesScanned} libraries, ${result.matched}/${result.itemsSeen} matched, ${result.clearedStale} cleared, ${result.autoTracked} auto-tracked`,
  );
  return result;
}

export async function scanSingleEmbyItem(itemId: string): Promise<boolean> {
  if (!EMBY_ADMIN_USER_ID) return false;

  let item: EmbyLibraryItem & { ParentId?: string };
  try {
    item = await embyFetch(
      `/Users/${EMBY_ADMIN_USER_ID}/Items/${itemId}?Fields=ProviderIds,ProductionYear,Overview`,
    );
  } catch (err) {
    log.warn(`Failed to fetch item ${itemId} for real-time scan:`, err);
    return false;
  }

  if (item.Type !== "Movie" && item.Type !== "Series") return false;

  const tmdbId = await resolveItemTmdbId(item);
  if (!tmdbId) return false;

  const type = item.Type === "Movie" ? "movie" : "tv";
  const titleMap = await ensureBrowseTitlesExist([
    { tmdbId, type, title: item.Name, posterPath: null },
  ]);
  const entry = titleMap.get(`${tmdbId}-${type}`);
  if (!entry) return false;

  const [before] = await getTitleById(entry.id);

  await markTitlesInEmbyLibrary([{ titleId: entry.id, embyItemId: item.Id, embyLibraryName: "" }]);
  notifyIfRequestNowAvailable(before, entry.id);
  const overview = item.Overview?.trim();
  if (overview) await updateTitleFields(entry.id, { overviewFr: overview });
  return true;
}

/**
 * Real-time counterpart to `scanSingleEmbyItem` for Emby's "library.deleted"
 * webhook — the item is already gone by the time this fires, so there's
 * nothing to re-fetch from Emby; just flip the matching title's
 * availability flag by the item ID Emby already gave us.
 */
export function handleSingleEmbyItemDeleted(itemId: string): Promise<boolean> {
  return clearSingleEmbyLibraryFlag(itemId);
}

export async function listEmbyLibrariesForUser(
  userId: string,
): Promise<{ libraries: string[]; selected: string[] }> {
  const [libraries, selected] = await Promise.all([
    getScannableLibraries(),
    getUserEmbyLibraries(userId),
  ]);
  return { libraries: libraries.map((l) => l.Name), selected };
}

export async function setEmbyLibrariesForUser(
  userId: string,
  libraryNames: string[],
): Promise<{ libraries: string[]; selected: string[] }> {
  await setUserEmbyLibraries(userId, libraryNames);
  return { libraries: [], selected: libraryNames };
}
