export type StoredStatus = "watchlist" | "in_progress" | "completed" | "dropped";

export type DisplayStatus = "in_watchlist" | "watching" | "caught_up" | "completed" | "dropped";

export const ONGOING_TMDB_STATUSES = ["Returning Series", "In Production"];

/**
 * Derive the user-facing display status from stored status + context.
 *
 * Movies: watchlist → in_watchlist, completed → completed
 * TV:     watchlist → in_watchlist, in_progress → watching | caught_up | completed
 */
export function getDisplayStatus(
  storedStatus: StoredStatus,
  titleType: "movie" | "tv",
  tmdbStatus: string | null,
  episodeProgress: { watched: number; total: number } | null,
  currentCycle = 1,
): DisplayStatus {
  if (storedStatus === "dropped") return "dropped";
  if (storedStatus === "watchlist") return "in_watchlist";
  if (titleType === "movie") return storedStatus === "completed" ? "completed" : "in_watchlist";

  // TV with in_progress: derive from episode progress + TMDB show status
  if (
    episodeProgress &&
    episodeProgress.total > 0 &&
    episodeProgress.watched >= episodeProgress.total
  ) {
    return ONGOING_TMDB_STATUSES.includes(tmdbStatus ?? "") ? "caught_up" : "completed";
  }

  // 31.08, Sid: "Watch Again" bumps currentCycle and puts the title back in
  // Continue Watching (wanted, kept), but until this special-case, 0
  // episodes watched in the fresh cycle read as "watching" (blue, looks
  // unwatched) right away — exactly the "I have to re-mark everything
  // before it looks seen again" complaint. A rewatch that hasn't logged its
  // first episode yet stays "completed" (green + rewatch badge) instead;
  // the moment >=1 episode is watched in this cycle, it falls through to
  // the normal "watching" progress below, same as any first watch-through.
  if (currentCycle > 1 && (episodeProgress?.watched ?? 0) === 0) {
    return ONGOING_TMDB_STATUSES.includes(tmdbStatus ?? "") ? "caught_up" : "completed";
  }

  return "watching";
}
