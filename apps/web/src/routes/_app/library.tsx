import { useLingui } from "@lingui/react/macro";
import { IconBooks, IconFilterOff } from "@tabler/icons-react";
import { skipToken, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { FilmsOverview } from "@/components/dashboard/films-overview";
import { SeriesOverview } from "@/components/dashboard/series-overview";
import { TitleGrid, TitleGridSectionSkeleton } from "@/components/dashboard/title-grid";
import { TitleList } from "@/components/dashboard/title-list";
import { WelcomeHeader } from "@/components/dashboard/welcome-header";
import {
  getPersistedViewMode,
  setPersistedViewMode,
  type LibraryViewMode,
} from "@/lib/appearance";
import { IconLayoutGrid, IconLayoutList } from "@tabler/icons-react";
import { LibraryToolbar } from "@/components/library/library-toolbar";
import { RouteError } from "@/components/route-error";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { withLoaderRetry } from "@/lib/loader-retry";
import { orpc } from "@/lib/orpc/client";

const librarySearchSchema = z.object({
  search: z.string().optional().catch(undefined),
  statuses: z.array(z.string()).optional().catch(undefined),
  type: z.enum(["movie", "tv"]).optional().catch(undefined),
  genreId: z.number().optional().catch(undefined),
  ratingMin: z.number().optional().catch(undefined),
  ratingMax: z.number().optional().catch(undefined),
  yearMin: z.number().optional().catch(undefined),
  yearMax: z.number().optional().catch(undefined),
  contentRating: z.string().optional().catch(undefined),
  sortBy: z.string().optional().catch(undefined),
  sortDirection: z.enum(["asc", "desc"]).optional().catch(undefined),
});

type LibrarySearch = z.infer<typeof librarySearchSchema>;

// Real perf bug found live (25.08, Sid: Films consistently slow to load,
// Séries fast) — the loader below used to unconditionally prefetch the flat,
// unfiltered library grid (2814 titles for her account) and block the route
// transition on it, even though isSeriesOverview/isFilmsOverview bypass that
// data entirely and render the section-based overview instead. Séries "felt"
// fast only because that same type-agnostic query was usually already warm
// in the 30s staleTime cache from a recent Séries visit; landing on Films
// first (or after the cache expired) paid the full unfiltered fetch for
// data about to be thrown away. Shared with the component below so the two
// can't drift out of sync.
function isOverviewSearch(search: LibrarySearch): boolean {
  const noOtherFilters =
    !search.search &&
    !search.statuses?.length &&
    !search.genreId &&
    !search.ratingMin &&
    !search.ratingMax &&
    !search.yearMin &&
    !search.yearMax &&
    !search.contentRating &&
    !search.sortBy;
  return (search.type === "tv" || search.type === "movie") && noOtherFilters;
}

export const Route = createFileRoute("/_app/library")({
  validateSearch: zodValidator(librarySearchSchema),
  staleTime: 30_000,
  // loaderDeps, not reading `search` directly in the loader — TanStack
  // Router only types/reruns the loader off explicitly declared deps.
  loaderDeps: ({ search }) => ({ needsFlatGrid: !isOverviewSearch(search) }),
  loader: async ({ context, deps }) => {
    // 19.09, Sid: "comment on peut aider cette ouverture à froid ?" —
    // genres isn't needed for the initial grid paint, only for the filter
    // dropdown in library-filters.tsx, which already reads it via a plain
    // non-suspense useQuery and renders fine while it's briefly undefined.
    // Awaiting it here just put it in the same concurrent burst as the
    // grid's own request on every cold open — real evidence in prod logs
    // that library/genres is consistently the FIRST slow call recorded
    // right before the whole server stalls. Fire it without awaiting so it
    // still warms react-query's cache in the background, but it can never
    // block (or compete for the single synchronous DB thread with) the
    // actual page content.
    void context.queryClient.ensureQueryData(orpc.library.genres.queryOptions());
    await withLoaderRetry(() => {
      const tasks: Promise<unknown>[] = [];
      if (deps.needsFlatGrid) {
        tasks.push(
          context.queryClient.ensureInfiniteQueryData(
            orpc.library.list.infiniteOptions({
              input: (pageParam: number) => ({ page: pageParam }),
              initialPageParam: 1,
              getNextPageParam: (lastPage) =>
                lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
              maxPages: 10,
            }),
          ),
        );
      }
      return Promise.all(tasks);
    });
  },
  head: () => ({ meta: [{ title: "Library — Patoune TV" }] }),
  pendingComponent: LibrarySkeleton,
  errorComponent: RouteError,
  component: LibraryPage,
});

function LibrarySkeleton() {
  return (
    <div className="space-y-6">
      <TitleGridSectionSkeleton />
      <TitleGridSectionSkeleton />
    </div>
  );
}

function LibraryPage() {
  const { t } = useLingui();
  const { session } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // Debounced search — update URL 300ms after the user stops typing
  const [prevSearchParam, setPrevSearchParam] = useState(search.search);
  const [localSearch, setLocalSearch] = useState(search.search ?? "");
  const [viewMode, setViewMode] = useState<LibraryViewMode>(() => getPersistedViewMode());

  function handleViewModeChange(mode: LibraryViewMode) {
    setViewMode(mode);
    setPersistedViewMode(mode);
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // Sync localSearch when URL params change externally (back/forward navigation)
  if (prevSearchParam !== search.search) {
    setPrevSearchParam(search.search);
    setLocalSearch(search.search ?? "");
  }

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const updateSearch = useCallback(
    (updates: Partial<LibrarySearch>) => {
      void navigate({
        search: (prev) => {
          const next = { ...prev, ...updates };
          // Remove undefined/empty values
          for (const [key, value] of Object.entries(next)) {
            if (
              value === undefined ||
              value === "" ||
              (Array.isArray(value) && value.length === 0)
            ) {
              delete (next as Record<string, unknown>)[key];
            }
          }
          return next;
        },
        replace: true,
      });
    },
    [navigate],
  );

  const handleFilterChange = useCallback(
    (key: string, value: unknown) => {
      const updates: Partial<LibrarySearch> = {
        [key]: value === "" || value === false ? undefined : value,
      };
      // Clear ratingMax when ratingMin changes (UI only exposes ratingMin now)
      if (key === "ratingMin") updates.ratingMax = undefined;
      updateSearch(updates);
    },
    [updateSearch],
  );

  const handleClearAll = useCallback(() => {
    setLocalSearch("");
    void navigate({ search: {}, replace: true });
  }, [navigate]);

  const handleSortChange = useCallback(
    (sortBy: string, sortDirection: string) => {
      updateSearch({ sortBy, sortDirection: sortDirection as "asc" | "desc" });
    },
    [updateSearch],
  );

  // Build input from search params
  const queryInput = useMemo(() => {
    const input: Record<string, unknown> = {};
    if (search.search) input.search = search.search;
    if (search.statuses?.length) input.statuses = search.statuses;
    if (search.type) input.type = search.type;
    if (search.genreId) input.genreId = search.genreId;
    if (search.ratingMin) input.ratingMin = search.ratingMin;
    if (search.ratingMax) input.ratingMax = search.ratingMax;
    if (search.yearMin) input.yearMin = search.yearMin;
    if (search.yearMax) input.yearMax = search.yearMax;
    if (search.contentRating) input.contentRating = search.contentRating;
    if (search.sortBy) input.sortBy = search.sortBy;
    if (search.sortDirection) input.sortDirection = search.sortDirection;
    return input;
  }, [search]);

  // Séries default landing view (24.08, Sid) — sectioned overview instead of
  // the flat filterable grid, but only while no other filter/search/sort is
  // active. The moment one is (via a section's "See all" link, or typing in
  // the search box), this falls back to the grid below — same URL, no route
  // change, so the "See all" links elsewhere already work as-is.
  const isSeriesOverview = search.type === "tv" && isOverviewSearch(search);
  const isFilmsOverview = search.type === "movie" && isOverviewSearch(search);

  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    ...orpc.library.list.infiniteOptions({
      input: (pageParam: number) => ({ ...queryInput, page: pageParam }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) =>
        lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
      maxPages: 10,
    }),
    enabled: !isSeriesOverview && !isFilmsOverview,
  });

  const sentinelRef = useInfiniteScroll({
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  });

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const totalResults = data?.pages[0]?.totalResults ?? 0;

  // No local matches for an active search: fall back to a TMDB search,
  // same source the command palette uses, so this field behaves like it.
  const trimmedSearch = search.search?.trim() ?? "";
  const tmdbFallbackEnabled = !isPending && items.length === 0 && trimmedSearch.length > 0;
  const { data: tmdbData, isLoading: tmdbLoading } = useQuery(
    orpc.discover.search.queryOptions({
      input: tmdbFallbackEnabled ? { query: trimmedSearch, type: search.type } : skipToken,
    }),
  );
  const tmdbResults = (tmdbData?.results ?? []).filter(
    (r): r is typeof r & { id: string } => r.type !== "person" && !!r.id,
  );

  // Count active filters (excluding sort)
  const activeFilterCount = [
    search.statuses?.length ? 1 : 0,
    search.type ? 1 : 0,
    search.genreId ? 1 : 0,
    search.ratingMin || search.ratingMax ? 1 : 0,
    search.yearMin || search.yearMax ? 1 : 0,
    search.contentRating ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  if (isSeriesOverview) {
    return (
      <div className="space-y-6">
        {/* 24.08, Sid: drop the generic "TV Shows" title, use the same
            personalized welcome header the dashboard has instead. */}
        <WelcomeHeader name={session.user.name} />
        <SeriesOverview />
      </div>
    );
  }

  if (isFilmsOverview) {
    return (
      <div className="space-y-6">
        <FilmsOverview />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <IconBooks aria-hidden={true} className="text-primary size-5" />
          <h1 className="font-display text-xl tracking-tight">{t`Library`}</h1>
        </div>
        <div className="border-border/50 flex items-center gap-0.5 rounded-lg border p-0.5">
          <button
            type="button"
            onClick={() => handleViewModeChange("grid")}
            aria-label={t`Grid view`}
            aria-pressed={viewMode === "grid"}
            className={`flex size-7 items-center justify-center rounded-md transition-colors ${
              viewMode === "grid"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <IconLayoutGrid className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => handleViewModeChange("list")}
            aria-label={t`List view`}
            aria-pressed={viewMode === "list"}
            className={`flex size-7 items-center justify-center rounded-md transition-colors ${
              viewMode === "list"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <IconLayoutList className="size-4" />
          </button>
        </div>
      </div>

      <LibraryToolbar
        search={localSearch}
        onSearchChange={(value: string) => {
          setLocalSearch(value);
          if (debounceRef.current) clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => {
            updateSearch({ search: value || undefined });
          }, 300);
        }}
        filters={{
          statuses: search.statuses,
          type: search.type,
          genreId: search.genreId,
          ratingMin: search.ratingMin,
          ratingMax: search.ratingMax,
          yearMin: search.yearMin,
          yearMax: search.yearMax,
          contentRating: search.contentRating,
        }}
        onFilterChange={handleFilterChange}
        onClearAll={handleClearAll}
        sortBy={search.sortBy ?? "added_at"}
        sortDirection={search.sortDirection ?? "desc"}
        onSortChange={handleSortChange}
        totalResults={totalResults}
        activeFilterCount={activeFilterCount}
      />

      {isPending || (tmdbFallbackEnabled && tmdbLoading) ? (
        <TitleGridSectionSkeleton />
      ) : items.length === 0 && tmdbResults.length > 0 ? (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm">
            {t`Not in your library yet — results from TMDB`}
          </p>
          {viewMode === "grid" ? <TitleGrid items={tmdbResults} /> : <TitleList items={tmdbResults} />}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <IconFilterOff className="text-muted-foreground/40 size-12" />
          <p className="text-muted-foreground text-lg">{t`No titles match your filters`}</p>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-primary text-sm hover:underline"
            >
              {t`Clear all filters`}
            </button>
          )}
        </div>
      ) : (
        <>
          {viewMode === "grid" ? <TitleGrid items={items} /> : <TitleList items={items} />}
          <div ref={sentinelRef} />
          {isFetchingNextPage && <TitleGridSectionSkeleton />}
        </>
      )}
    </div>
  );
}
