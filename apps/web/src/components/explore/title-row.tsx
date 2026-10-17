import { FeedSection } from "@/components/dashboard/feed-section";
import { TitleCard } from "@/components/title-card";

interface TitleRowItem {
  id: string;
  type: "movie" | "tv";
  title: string;
  posterPath: string | null;
  posterThumbHash?: string | null;
  releaseDate: string | null;
  firstAirDate: string | null;
  voteAverage: number | null;
  embyStatus?: "available" | "removed" | null;
  requestedAt?: Date | string | null;
}

interface TitleRowProps {
  /** Stable identifier for FeedSection's own collapsed-state persistence
   * (localStorage) — must be distinct per row, or two rows silently share
   * the same remembered open/closed state. Found 17.10 while adding a 5th
   * TitleRow (Top Movies of the Year): every existing caller had been
   * getting "trending-today" via this component's own former hardcoded
   * default, including Upcoming Series/Movies, not just Trending Today. */
  id: string;
  heading: string;
  icon: React.ReactNode;
  items: TitleRowItem[];
  userStatuses?: Record<
    string,
    "in_watchlist" | "watching" | "caught_up" | "completed" | "dropped"
  >;
  episodeProgress?: Record<string, { watched: number; total: number }>;
}

/**
 * Wrapping grid (24.08, Sid), same density setting as the library grid
 * (--title-grid-columns, appearance.ts) — was a horizontal scrolling
 * carousel. Now single-page/capped (Trending's own procedure caps 10
 * movies + 10 series and filters anime/already-owned — see discover.ts) so
 * there's no pagination to wire here anymore; FeedSection gives it the
 * chevron/collapse Sid asked for, same as every dashboard section.
 */
export function TitleRow({
  id,
  heading,
  icon,
  items,
  userStatuses,
  episodeProgress,
}: TitleRowProps) {
  if (items.length === 0) return null;

  return (
    <FeedSection
      id={id}
      collapsible
      defaultOpen
      title={heading}
      icon={icon}
      countLabel={`(${items.length})`}
    >
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(var(--title-grid-columns, 5), minmax(0, 1fr))" }}
      >
        {items.map((item, i) => (
          <div
            key={item.id}
            className="animate-stagger-item"
            style={{ "--stagger-index": i } as React.CSSProperties}
          >
            <TitleCard
              id={item.id}
              type={item.type}
              title={item.title}
              posterPath={item.posterPath}
              posterThumbHash={item.posterThumbHash}
              releaseDate={item.releaseDate ?? item.firstAirDate}
              voteAverage={item.voteAverage}
              embyStatus={item.embyStatus}
              requestedAt={item.requestedAt}
              userStatus={userStatuses?.[item.id]}
              episodeProgress={episodeProgress?.[item.id]}
            />
          </div>
        ))}
      </div>
    </FeedSection>
  );
}
