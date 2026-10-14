import { AvailableEmbySection } from "./available-emby-section";
import { RecommendationsSection } from "./recommendations-section";
import { RequestedNotAvailableSection } from "./requested-not-available-section";
import { ToWatchSection } from "./to-watch-section";
import { UpcomingCardsSection } from "./upcoming-cards-section";
import { WatchedMoviesSection } from "./watched-movies-section";

/**
 * Films landing page (24.08, Sid) — same pattern as SeriesOverview, mirrors
 * her original Films spec: available-and-tracked ("To Watch"), requested but
 * not yet available, available-but-not-tracked ("Possédé"), and watched
 * split by whether the file is still on Emby (lets her spot removed files
 * instead of them silently vanishing). Same flat-grid fallback as Séries —
 * LibraryPage switches to it the moment a filter/search/sort is applied.
 */
export function FilmsOverview() {
  return (
    <div className="space-y-8">
      <ToWatchSection type="movie" />
      <UpcomingCardsSection type="movie" />
      <RequestedNotAvailableSection type="movie" />
      <AvailableEmbySection type="movie" />
      <RecommendationsSection type="movie" />
      <WatchedMoviesSection />
    </div>
  );
}
