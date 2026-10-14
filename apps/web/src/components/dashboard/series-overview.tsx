import { CaughtUpSection } from "./caught-up-section";
import { CompletedSeriesSection } from "./completed-series-section";
import { DroppedSeriesSection } from "./dropped-series-section";
import { NowPlayingSection } from "./now-playing-section";
import { RecommendationsSection } from "./recommendations-section";
import { RequestedNotAvailableSection } from "./requested-not-available-section";
import { ToWatchSection } from "./to-watch-section";
import { UpcomingCardsSection } from "./upcoming-cards-section";

// WaitingForEpisodesSection (waiting-for-episodes-section.tsx) deliberately
// not rendered below (24.08, Sid) — mixed "coming soon, just not downloaded
// yet" with "no idea if/when ever", found more confusing than useful.
// Replaced by RequestedNotAvailableSection below, scoped to real requests
// only. Component + query kept on disk, easy to bring back; nothing deleted
// from anyone's watchlist, just not shown on this page.

/**
 * Séries landing page (24.08, Sid) — replaces the flat filterable grid as
 * the default view for /library?type=tv. Final section order/naming per her
 * numbered list (24.08, matched against a reference app screenshot she
 * shared): Now Playing (compact) → In Progress/To Start → Upcoming Releases
 * → Requested-Not-Available → Recommendations → Followed-Up-to-Date →
 * Completed → Dropped. The flat filterable grid (search/genre/rating/year
 * filters, infinite scroll) is still there — it's what LibraryPage falls
 * back to the moment any filter, search, or sort is applied, reachable from
 * any section's "See all" link.
 */
export function SeriesOverview() {
  return (
    <div className="space-y-8">
      <NowPlayingSection compact />
      <ToWatchSection type="tv" />
      <UpcomingCardsSection type="tv" />
      <RequestedNotAvailableSection type="tv" />
      <RecommendationsSection type="tv" />
      <CaughtUpSection />
      <CompletedSeriesSection />
      <DroppedSeriesSection />
    </div>
  );
}
