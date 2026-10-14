import { getTitlesByIds } from "@sofa/db/queries/discovery";
import { getIntegrationByUserAndProvider } from "@sofa/db/queries/integrations";
import { createLogger } from "@sofa/logger";
import { tmdbImageUrl } from "@sofa/tmdb/image";

import { getEmbyNowPlaying } from "./emby";
import { ensureBrowseTitlesExist } from "./metadata";

const log = createLogger("now-playing");

export interface NowPlayingItem {
  sessionId: string;
  userName: string | null;
  titleId: string | null;
  type: "movie" | "tv";
  title: string;
  posterPath: string | null;
  posterThumbHash: string | null;
  episodeName: string | null;
  seasonNumber: number | null;
  episodeNumber: number | null;
  progressPercent: number;
  isPaused: boolean;
}

export async function getNowPlayingFeed(userId: string): Promise<NowPlayingItem[]> {
  // 30.09, Sid: still 50-59s per poll after the WAL/cacheImages/TMDB-dedup
  // fixes, and growing across repeated tests - none of those explained it,
  // so instrumenting every step here instead of guessing again. Same
  // >500ms-only-logs-if-slow pattern as reconcileEmbyWatchStatus's logStep.
  let stepStart = performance.now();
  function logStep(label: string) {
    const ms = Math.round(performance.now() - stepStart);
    if (ms > 500) log.warn(`getNowPlayingFeed: ${label} took ${ms}ms`);
    stepStart = performance.now();
  }

  const [integration] = await getIntegrationByUserAndProvider(userId, "emby");
  const embyUsername = integration?.embyUsername ?? null;
  logStep("getIntegrationByUserAndProvider");

  const allSessions = await getEmbyNowPlaying();
  logStep(`getEmbyNowPlaying (${allSessions.length} sessions)`);

  // Only show sessions for the Emby user linked to this Sofa account.
  // If no Emby username is linked yet, show nothing rather than everyone's sessions.
  const sessions = embyUsername
    ? allSessions.filter((s) => s.userName === embyUsername)
    : [];

  if (sessions.length === 0) return [];

  const withTmdb = sessions.filter((s) => s.tmdbId != null);

  const browseItems = withTmdb.map((s) => ({
    tmdbId: s.tmdbId!,
    type: s.type,
    title: s.type === "tv" ? (s.seriesName ?? s.episodeName ?? "") : (s.episodeName ?? ""),
    posterPath: null,
    releaseDate: null,
    firstAirDate: null,
    voteAverage: null,
  }));

  const titleMap =
    browseItems.length > 0
      ? await ensureBrowseTitlesExist(browseItems)
      : new Map<string, { id: string }>();
  logStep(`ensureBrowseTitlesExist (${browseItems.length} items)`);

  const matchedIds = [...titleMap.values()].map((e) => e.id).filter(Boolean);
  const fullTitles = matchedIds.length > 0 ? await getTitlesByIds(matchedIds) : [];
  const titleById = new Map(fullTitles.map((t) => [t.id, t]));
  logStep(`getTitlesByIds (${matchedIds.length} ids)`);

  return sessions.map((s) => {
    const entry = s.tmdbId != null ? titleMap.get(`${s.tmdbId}-${s.type}`) : undefined;
    const fullTitle = entry ? titleById.get(entry.id) : undefined;

    return {
      sessionId: s.sessionId,
      userName: s.userName,
      titleId: entry?.id ?? null,
      type: s.type,
      title: fullTitle?.title ?? (s.type === "tv" ? (s.seriesName ?? "") : (s.episodeName ?? "")),
      posterPath: fullTitle ? tmdbImageUrl(fullTitle.posterPath, "posters") : null,
      posterThumbHash: fullTitle?.posterThumbHash ?? null,
      episodeName: s.type === "tv" ? s.episodeName : null,
      seasonNumber: s.seasonNumber,
      episodeNumber: s.episodeNumber,
      progressPercent: s.progressPercent,
      isPaused: s.isPaused,
    };
  });
}
