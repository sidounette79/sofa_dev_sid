import { Trans, useLingui } from "@lingui/react/macro";
import { IconCalendarEvent, IconChevronDown, IconHourglassEmpty } from "@tabler/icons-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { useState } from "react";
import { z } from "zod";

import { TitleGrid, TitleGridSectionSkeleton } from "@/components/dashboard/title-grid";
import { UpcomingRow } from "@/components/dashboard/upcoming-item";
import { RouteError } from "@/components/route-error";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { getPersistedSectionOpen, setPersistedSectionOpen } from "@/lib/appearance";
import { withLoaderRetry } from "@/lib/loader-retry";
import { orpc } from "@/lib/orpc/client";
import { groupByDateBucket } from "@sofa/i18n/date-buckets";

const upcomingSearchSchema = z.object({
  type: z.enum(["all", "movie", "tv"]).optional().catch(undefined),
  status: z.enum(["all", "watching", "watchlist"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/upcoming")({
  validateSearch: zodValidator(upcomingSearchSchema),
  staleTime: 30_000,
  loader: async ({ context }) => {
    await withLoaderRetry(() =>
      Promise.all([
        context.queryClient.ensureInfiniteQueryData(
          orpc.library.upcoming.infiniteOptions({
            input: (pageParam: string | undefined) => ({
              days: 90,
              limit: 20,
              cursor: pageParam,
            }),
            initialPageParam: undefined as string | undefined,
            getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
            maxPages: 10,
          }),
        ),
        context.queryClient.ensureQueryData(
          orpc.mediaRequests.listUnresolvedSeriesRequests.queryOptions(),
        ),
      ]),
    );
  },
  head: () => ({ meta: [{ title: "Upcoming — Patoune TV" }] }),
  pendingComponent: UpcomingSkeleton,
  errorComponent: RouteError,
  component: UpcomingPage,
});

function UpcomingSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-3.5 py-2">
          <Skeleton className="size-[52px] rounded-md" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
        </div>
      ))}
    </div>
  );
}

function UpcomingPage() {
  const { t } = useLingui();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  // 06.09, Sid: collapse a date section (e.g. "This week") to jump past it
  // without scrolling through every card. Persisted (same mechanism as the
  // dashboard's own collapsible sections) so it survives a reload — a
  // section she's already checked stays out of the way next time too.
  // Real state (not a forceRerender hack, which shipped a real bug: the
  // click landed and localStorage updated correctly, but nothing on screen
  // reflected it until a full reload) — this map is what the render below
  // actually reads, so React knows to re-render the instant it changes.
  const [bucketOverrides, setBucketOverrides] = useState<Record<string, boolean>>({});
  function isBucketOpen(key: string): boolean {
    if (key in bucketOverrides) return bucketOverrides[key];
    return getPersistedSectionOpen(`upcoming-bucket:${key}`, true);
  }
  function toggleBucket(key: string) {
    const next = !isBucketOpen(key);
    setPersistedSectionOpen(`upcoming-bucket:${key}`, next);
    setBucketOverrides((prev) => ({ ...prev, [key]: next }));
  }

  const typeFilter = search.type ?? "all";
  const statusFilter = search.status ?? "all";

  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    orpc.library.upcoming.infiniteOptions({
      input: (pageParam: string | undefined) => ({
        days: 90,
        limit: 20,
        cursor: pageParam,
        mediaType: typeFilter !== "all" ? (typeFilter as "movie" | "tv") : undefined,
        statusFilter:
          statusFilter !== "all" ? [statusFilter as "watching" | "watchlist"] : undefined,
      }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      maxPages: 10,
    }),
  );

  const sentinelRef = useInfiniteScroll({
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  });

  // 06.09, Sid — "En attente TMDB": series she requested that TheTVDB
  // doesn't have indexed yet. Deliberately separate from the date-bucketed
  // list above and from its 90-day window — same principle as Grimmory's
  // "missing books" — so it doesn't disappear once the expected air date
  // passes, only once a plain Request (the poster's own + button) succeeds.
  const { data: unresolvedData, isPending: unresolvedPending } = useQuery(
    orpc.mediaRequests.listUnresolvedSeriesRequests.queryOptions(),
  );
  const unresolvedItems = unresolvedData?.items ?? [];

  function setTypeFilter(value: string) {
    void navigate({
      search: (prev) => ({
        ...prev,
        type: value === "all" ? undefined : (value as "movie" | "tv"),
      }),
      replace: true,
    });
  }

  function setStatusFilter(value: string) {
    void navigate({
      search: (prev) => ({
        ...prev,
        status: value === "all" ? undefined : (value as "watching" | "watchlist"),
      }),
      replace: true,
    });
  }

  const filterToggles = (
    <div className="flex flex-wrap gap-3">
      <ToggleGroup
        value={[typeFilter]}
        onValueChange={(values) => {
          const next = values.find((v) => v !== typeFilter) ?? "all";
          setTypeFilter(next);
        }}
        variant="outline"
        size="sm"
      >
        <ToggleGroupItem value="all">{t`All`}</ToggleGroupItem>
        <ToggleGroupItem value="movie">{t`Movies`}</ToggleGroupItem>
        <ToggleGroupItem value="tv">{t`TV Shows`}</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup
        value={[statusFilter]}
        onValueChange={(values) => {
          const next = values.find((v) => v !== statusFilter) ?? "all";
          setStatusFilter(next);
        }}
        variant="outline"
        size="sm"
      >
        <ToggleGroupItem value="all">{t`All`}</ToggleGroupItem>
        <ToggleGroupItem value="watching">{t`Watching`}</ToggleGroupItem>
        <ToggleGroupItem value="watchlist">{t`Watchlist`}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );

  if (isPending) return <UpcomingSkeleton />;

  const allItems = data?.pages.flatMap((p) => p.items) ?? [];

  if (allItems.length === 0) {
    return (
      <div className="space-y-10">
        <div className="mx-auto max-w-2xl space-y-6">
          <UpcomingHeader />
          {filterToggles}
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <IconCalendarEvent className="text-muted-foreground/40 size-12" />
            <p className="text-muted-foreground mt-4 text-sm">
              <Trans>No upcoming episodes or releases in the next 90 days.</Trans>
            </p>
          </div>
        </div>
        <UnresolvedSection items={unresolvedItems} isPending={unresolvedPending} />
      </div>
    );
  }

  const buckets = groupByDateBucket(allItems);

  return (
    <div className="space-y-10">
      <div className="mx-auto max-w-2xl space-y-6">
        <UpcomingHeader />
        {filterToggles}
        {buckets.map((bucket) => {
          const isOpen = isBucketOpen(bucket.key);
          return (
            <section key={bucket.key}>
              <Collapsible open={isOpen} onOpenChange={() => toggleBucket(bucket.key)}>
                <CollapsibleTrigger className="font-display text-muted-foreground mb-2 flex w-full cursor-pointer items-center gap-1.5 text-sm font-medium tracking-wider uppercase">
                  {bucket.label}
                  <IconChevronDown
                    aria-hidden={true}
                    className={`size-3.5 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                  />
                </CollapsibleTrigger>
                <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
                  <div className="space-y-2">
                    {bucket.items.map((item, i) => (
                      <UpcomingRow key={`${item.titleId}-${item.date}-${i}`} item={item} />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </section>
          );
        })}
        <div ref={sentinelRef} />
        {isFetchingNextPage && <UpcomingSkeleton />}
      </div>
      <UnresolvedSection items={unresolvedItems} isPending={unresolvedPending} />
    </div>
  );
}

function UnresolvedSection({
  items,
  isPending,
}: {
  items: { id: string; type: "tv"; title: string; posterPath: string | null; posterThumbHash: string | null; firstAirDate: string | null; voteAverage: number | null }[];
  isPending: boolean;
}) {
  const { t } = useLingui();
  if (isPending) return <TitleGridSectionSkeleton />;
  if (items.length === 0) return null;
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <IconHourglassEmpty className="text-muted-foreground size-5" />
        <h2 className="font-display text-xl tracking-tight">{t`Pending TMDB`}</h2>
      </div>
      <p className="text-muted-foreground -mt-1 text-sm">
        <Trans>
          Requested, but TheTVDB doesn't have this show yet — retry with the poster's + once it
          does.
        </Trans>
      </p>
      <TitleGrid
        items={items.map((item) => ({
          id: item.id,
          type: item.type,
          title: item.title,
          posterPath: item.posterPath,
          posterThumbHash: item.posterThumbHash,
          firstAirDate: item.firstAirDate,
          voteAverage: item.voteAverage,
        }))}
      />
    </section>
  );
}

function UpcomingHeader() {
  const { t } = useLingui();
  return (
    <div>
      <h1 className="font-display text-2xl tracking-tight">{t`Upcoming`}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        <Trans>Episodes and movies coming up in the next 90 days.</Trans>
      </p>
      <div className="text-muted-foreground mt-2 flex items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="bg-status-watching inline-block size-2 rounded-full" />
          <Trans>Currently watching</Trans>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-status-completed inline-block size-2 rounded-full" />
          <Trans>Caught up / completed</Trans>
        </span>
      </div>
    </div>
  );
}
