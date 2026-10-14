import { Trans, useLingui } from "@lingui/react/macro";
import {
  IconPlayerPlay,
  IconSortAscending,
  IconSortDescending,
} from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { orpc } from "@/lib/orpc/client";

import { FeedSection } from "./feed-section";
import { TitleGrid, TitleGridSectionSkeleton } from "./title-grid";

export function ToWatchSection({ type }: { type?: "movie" | "tv" } = {}) {
  const { t } = useLingui();
  const [sortBy, setSortBy] = useState<"watched" | "aired">("watched");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  // getContinueWatchingFeed is TV-only by nature (next-episode progress has
  // no movie equivalent) — skip it entirely on a movies-only page instead of
  // fetching data that would always come back empty.
  const { data: cwData, isPending: cwPending } = useQuery({
    ...orpc.library.continueWatching.queryOptions({ input: { sortBy, sortDirection } }),
    enabled: type !== "movie",
  });
  // Real bug found live (24.08, Sid): hardcoded limit:10 was invisible on
  // Séries (continueWatching items padded the merged list out to the real
  // total) but silently truncated Films — she has 26 available watchlisted
  // movies, only 10 ever showed. 100 covers real-world "à voir" sizes with
  // room to spare — same reasoning as the 26.08 header-count-accuracy pass:
  // the embyStatus filter below happens client-side, so the fetch cap must
  // stay generous enough that mergedItems.length below reflects reality.
  // 28.08, Sid — real bug found live: this was bumped to 300 at some point,
  // past PaginatedInput's own max(100) (schemas.ts) — every request from
  // this section failed server-side input validation (400, "limit... too_big
  // ... maximum:100", confirmed in the sofa container logs), and since it's
  // batched together with every other Séries/Films-tab query in one HTTP
  // request (BatchLinkPlugin), that one failure broke the whole tab (stuck
  // loading, or the route's generic error page). 100 is the schema's real
  // ceiling — can't go higher client-side without also widening
  // PaginatedInput itself, which is shared by other endpoints best left alone.
  const { data: tsData, isPending: tsPending } = useQuery(
    orpc.library.list.queryOptions({
      input: { page: 1, limit: 100, statuses: ["in_watchlist"], ...(type ? { type } : {}) },
    }),
  );

  const sortLabels = {
    watched: t`Last watched`,
    aired: t`Last aired`,
  };

  if (cwPending || tsPending) return <TitleGridSectionSkeleton />;

  // Guard against stale cross-page cache leakage: `library.continueWatching`
  // has no type in its query key, so on the Films page `cwData` can still
  // hold TV items fetched earlier on the Séries page even with `enabled:
  // false` above (that only stops refetching, it doesn't clear cached data).
  // Real bug found live (24.08, Sid, screenshot): TV shows appearing first
  // in "En cours / À commencer" on Films.
  const cwItems = type === "movie" ? [] : (cwData?.items ?? []);
  // Real bug found live (24.08, Sid: watchlisted shows with zero downloaded
  // episodes — e.g. "Accident, Suicide or Murder" — showed up in "To Watch"
  // even though there was nothing to actually watch). The watchlist half of
  // this section never checked Emby availability, only the watchlist status
  // itself. "available" means genuinely on Emby right now — "removed"
  // (previously downloaded, gone since) and null (never seen) both mean
  // there's nothing watchable yet.
  const tsItems = (tsData?.items ?? []).filter((item) => item.embyStatus === "available");
  if (cwItems.length === 0 && tsItems.length === 0) return null;

  // In-progress shows first (already-watching, sorted per the dropdown above),
  // not-yet-started titles after — one continuous poster grid instead of two
  // visually different sections.
  const mergedItems = [
    ...cwItems.map((item) => ({
      id: item.title.id,
      type: item.title.type,
      title: item.title.title,
      posterPath: item.title.posterPath,
      posterThumbHash: item.title.posterThumbHash,
      firstAirDate: item.title.firstAirDate,
      status: item.title.status,
      voteAverage: item.title.voteAverage,
      embyStatus: item.title.embyStatus,
      watchCount: item.title.watchCount,
      userStatus: "watching" as const,
      episodeProgress: { watched: item.watchedEpisodes, total: item.totalEpisodes },
      episodeLabel: item.nextEpisode
        ? `S${item.nextEpisode.seasonNumber}E${item.nextEpisode.episodeNumber}`
        : null,
    })),
    ...tsItems,
  ];

  return (
    <FeedSection
      id="to-watch"
      collapsible
      defaultOpen
      title={t`In Progress / To Start`}
      countLabel={`(${mergedItems.length})`}
      icon={<IconPlayerPlay className="text-primary size-5" />}
      actions={
        cwItems.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="xs" className="text-muted-foreground text-xs">
                    {sortLabels[sortBy]}
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="cursor-pointer" onClick={() => setSortBy("watched")}>
                  <span className={sortBy === "watched" ? "text-primary font-medium" : ""}>
                    {sortLabels.watched}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem className="cursor-pointer" onClick={() => setSortBy("aired")}>
                  <span className={sortBy === "aired" ? "text-primary font-medium" : ""}>
                    {sortLabels.aired}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
              aria-label={sortDirection === "asc" ? t`Ascending` : t`Descending`}
              className="text-muted-foreground"
            >
              {sortDirection === "asc" ? (
                <IconSortAscending aria-hidden={true} className="size-3.5" />
              ) : (
                <IconSortDescending aria-hidden={true} className="size-3.5" />
              )}
            </Button>
          </div>
        ) : undefined
      }
    >
      <TitleGrid items={mergedItems} />
      {(tsData?.totalResults ?? 0) > tsItems.length && (
        <div className="mt-3 text-right">
          <Link
            to="/library"
            search={{ statuses: ["in_watchlist", "watching"], ...(type ? { type } : {}) }}
            className="text-primary text-sm hover:underline"
          >
            <Trans>See all</Trans>
          </Link>
        </div>
      )}
    </FeedSection>
  );
}
