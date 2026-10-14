import { Trans } from "@lingui/react/macro";
import { skipToken, useInfiniteQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { FeedSection } from "@/components/dashboard/feed-section";
import { TitleCard, TitleCardSkeleton } from "@/components/title-card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { translateGenreName } from "@/lib/genre-names";
import { orpc } from "@/lib/orpc/client";

interface Genre {
  id: number;
  name: string;
}

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

type TitleStatus = "in_watchlist" | "watching" | "caught_up" | "completed" | "dropped";

interface FilterableTitleRowProps {
  heading: string;
  icon: React.ReactNode;
  mediaType: "movie" | "tv";
  defaultItems: TitleRowItem[];
  genres: Genre[];
  userStatuses?: Record<string, TitleStatus>;
  episodeProgress?: Record<string, { watched: number; total: number }>;
}

// Same cap as Trending/Popular/Upcoming — a genre chip used to keep paging
// until it ran dry (24.08, Sid: "ça défile sans fin aussi... dans les
// sous-menus"). The backend (discover.browse) stays uncapped for
// DiscoverSection's real deep-search use, so this stops fetching client-side
// once enough accumulate instead.
const GENRE_FILTER_CAP = 30;

/** Wrapping grid — see TitleRow's doc comment for the 24.08 grid-layout request. */
export function FilterableTitleRow({
  heading,
  icon,
  mediaType,
  defaultItems,
  genres,
  userStatuses: initialStatuses = {},
  episodeProgress: initialProgress = {},
}: FilterableTitleRowProps) {
  const [selectedGenre, setSelectedGenre] = useState<number | null>(null);
  const {
    data: discoverData,
    isPending,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery(
    orpc.discover.browse.infiniteOptions({
      input:
        selectedGenre != null
          ? (pageParam: number) => ({
              type: mediaType,
              genreId: selectedGenre,
              page: pageParam,
            })
          : skipToken,
      initialPageParam: 1,
      getNextPageParam: (lastPage) =>
        lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
      maxPages: 10,
    }),
  );

  const discoverItemsRaw = useMemo(
    () => discoverData?.pages.flatMap((p) => p.items) ?? [],
    [discoverData?.pages],
  );
  const discoverItems = useMemo(
    () => discoverItemsRaw.slice(0, GENRE_FILTER_CAP),
    [discoverItemsRaw],
  );
  const discoverStatuses = useMemo(
    () =>
      Object.assign({}, ...(discoverData?.pages.map((p) => p.userStatuses) ?? [])) as Record<
        string,
        TitleStatus
      >,
    [discoverData?.pages],
  );
  const discoverProgress = useMemo(
    () =>
      Object.assign({}, ...(discoverData?.pages.map((p) => p.episodeProgress) ?? [])) as Record<
        string,
        { watched: number; total: number }
      >,
    [discoverData?.pages],
  );

  const isLoading = selectedGenre !== null && isPending;
  const items = selectedGenre === null ? defaultItems : discoverItems;
  const userStatuses = selectedGenre === null ? initialStatuses : discoverStatuses;
  const episodeProgress = selectedGenre === null ? initialProgress : discoverProgress;
  const canPaginate = selectedGenre !== null && discoverItemsRaw.length < GENRE_FILTER_CAP;

  const sentinelRef = useInfiniteScroll({
    fetchNextPage,
    hasNextPage: canPaginate && hasNextPage,
    isFetchingNextPage,
  });

  function toggleGenre(genreId: number) {
    setSelectedGenre(genreId === selectedGenre ? null : genreId);
  }

  return (
    <FeedSection
      id={`filterable-${mediaType}`}
      title={heading}
      icon={icon}
      collapsible
      defaultOpen
      countLabel={`(${items.length})`}
    >
      <div className="space-y-4">
        {/* Genre chips — stays a horizontal scroll, it's a filter bar, not content cards */}
        <ScrollArea scrollFade hideScrollbar>
          <div className="flex gap-2">
            {genres.map((genre) => (
              <Button
                key={genre.id}
                variant={selectedGenre === genre.id ? "default" : "outline"}
                size="sm"
                onClick={() => toggleGenre(genre.id)}
                className={`shrink-0 rounded-full ${
                  selectedGenre === genre.id
                    ? "border-primary bg-primary/10 text-primary hover:bg-primary/20"
                    : "border-border/50 bg-card/50 text-muted-foreground hover:border-primary/20 hover:text-foreground"
                }`}
              >
                {translateGenreName(genre.name)}
              </Button>
            ))}
          </div>
        </ScrollArea>

        {/* Loading skeleton */}
        {isLoading && (
          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(var(--title-grid-columns, 5), minmax(0, 1fr))" }}
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <TitleCardSkeleton key={`skel-${i}`} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && selectedGenre !== null && items.length === 0 && (
          <p className="text-muted-foreground py-8 text-center text-sm">
            <Trans>No titles found for this genre.</Trans>
          </p>
        )}

        {/* Title cards */}
        {!isLoading && items.length > 0 && (
          <>
            <div
              key={selectedGenre ?? "default"}
              className="grid gap-4"
              style={{ gridTemplateColumns: "repeat(var(--title-grid-columns, 5), minmax(0, 1fr))" }}
            >
              {items.map((item: TitleRowItem, i: number) => (
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
                    userStatus={userStatuses[item.id]}
                    episodeProgress={episodeProgress[item.id]}
                  />
                </div>
              ))}
            </div>
            {canPaginate && <div ref={sentinelRef} />}
            {isFetchingNextPage && (
              <div className="flex items-center justify-center py-4">
                <div className="border-primary size-5 animate-spin rounded-full border-2 border-t-transparent" />
              </div>
            )}
          </>
        )}
      </div>
    </FeedSection>
  );
}
