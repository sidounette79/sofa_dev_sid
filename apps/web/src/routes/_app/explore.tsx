import { useLingui } from "@lingui/react/macro";
import {
  IconCalendarPlus,
  IconDeviceTv,
  IconFlame,
  IconMovie,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { DiscoverSearchBar } from "@/components/explore/discover-search-bar";
import { DiscoverSection } from "@/components/explore/discover-section";
import { FilterableTitleRow } from "@/components/explore/filterable-title-row";
import { HeroBanner } from "@/components/explore/hero-banner";
import { TitleRow } from "@/components/explore/title-row";
import { RouteError } from "@/components/route-error";
import { Skeleton } from "@/components/ui/skeleton";
import { withLoaderRetry } from "@/lib/loader-retry";
import { orpc } from "@/lib/orpc/client";

// 06.09, Sid: three real bugs found together — (1) filters lived in plain
// useState inside DiscoverSection, so leaving to a title page and coming
// back sometimes lost them and the scroll position (whether it survived
// depended on whether the router happened to keep the old component
// instance alive); (2) switching a filter didn't reliably start a clean
// infinite-query — leftover items from a previous filter combination could
// still be sitting in `items` (self-inflicted, not TMDB: verified the raw
// TMDB response for the exact same params contains none of the stray
// titles she saw). Moving every filter into the URL fixes both: the
// browser's own history is now the single source of truth, and each
// distinct filter combination gets its own real, stable query key instead
// of one shared across whatever the closures happened to hold.
const discoverSearchSchema = z.object({
  discoverType: z.enum(["movie", "tv"]).optional().catch(undefined),
  discoverGenreId: z.number().optional().catch(undefined),
  discoverYearMin: z.number().optional().catch(undefined),
  discoverYearMax: z.number().optional().catch(undefined),
  discoverRatingMin: z.number().optional().catch(undefined),
  discoverSortBy: z
    .enum([
      "popularity.desc",
      "vote_average.desc",
      "primary_release_date.desc",
      "primary_release_date.asc",
    ])
    .optional()
    .catch(undefined),
  discoverLanguage: z.string().optional().catch(undefined),
  discoverPlatformId: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/explore")({
  staleTime: 60_000,
  validateSearch: zodValidator(discoverSearchSchema),
  loader: async ({ context }) => {
    await withLoaderRetry(() =>
      Promise.all([
        context.queryClient.ensureQueryData(
          orpc.discover.trending.queryOptions({ input: { type: "all", page: 1 } }),
        ),
        context.queryClient.ensureQueryData(
          orpc.discover.upcomingSeries.queryOptions({ input: { page: 1 } }),
        ),
        context.queryClient.ensureQueryData(
          orpc.discover.upcomingMovies.queryOptions({ input: { page: 1 } }),
        ),
        context.queryClient.ensureQueryData(
          orpc.discover.popular.queryOptions({ input: { type: "tv" } }),
        ),
        context.queryClient.ensureQueryData(
          orpc.discover.popular.queryOptions({ input: { type: "movie" } }),
        ),
        context.queryClient.ensureQueryData(
          orpc.discover.genres.queryOptions({ input: { type: "movie" } }),
        ),
        context.queryClient.ensureQueryData(
          orpc.discover.genres.queryOptions({ input: { type: "tv" } }),
        ),
      ]),
    );
  },
  head: () => ({ meta: [{ title: "Explore — Patoune TV" }] }),
  pendingComponent: ExploreSkeletons,
  errorComponent: RouteError,
  component: ExplorePage,
});

function ExploreSkeletons() {
  return (
    <div className="space-y-6">
      <DiscoverSearchBar />
      <Skeleton className="-mt-6 mr-[calc(-50vw+50%)] ml-[calc(-50vw+50%)] h-[320px] rounded-none" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="space-y-4">
          <div className="flex items-center gap-2">
            <Skeleton className="size-5 rounded" />
            <Skeleton className="h-6 w-32" />
          </div>
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 8 }).map((_, j) => (
              <div key={j} className="w-[140px] shrink-0 sm:w-[160px]">
                <Skeleton className="aspect-[2/3] w-full rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function mergeMaps<T>(...maps: (Record<string, T> | undefined)[]): Record<string, T> {
  return Object.assign({}, ...maps.filter(Boolean));
}

function ExplorePage() {
  const { t } = useLingui();
  const discoverSearch = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: trendingData, isPending: trendingPending } = useQuery(
    orpc.discover.trending.queryOptions({ input: { type: "all", page: 1 } }),
  );
  const { data: upcomingSeriesData, isPending: upcomingSeriesPending } = useQuery(
    orpc.discover.upcomingSeries.queryOptions({ input: { page: 1 } }),
  );
  const { data: upcomingMoviesData, isPending: upcomingMoviesPending } = useQuery(
    orpc.discover.upcomingMovies.queryOptions({ input: { page: 1 } }),
  );
  const { data: popularTvData, isPending: tvPending } = useQuery(
    orpc.discover.popular.queryOptions({ input: { type: "tv" } }),
  );
  const { data: popularMoviesData, isPending: moviesPending } = useQuery(
    orpc.discover.popular.queryOptions({ input: { type: "movie" } }),
  );
  const { data: movieGenreData } = useQuery(
    orpc.discover.genres.queryOptions({ input: { type: "movie" } }),
  );
  const { data: tvGenreData } = useQuery(
    orpc.discover.genres.queryOptions({ input: { type: "tv" } }),
  );

  const isPending =
    trendingPending || upcomingSeriesPending || upcomingMoviesPending || tvPending || moviesPending;

  const trendingItems = trendingData?.items ?? [];
  const hero = trendingData?.hero ?? null;

  if (isPending) return <ExploreSkeletons />;

  // Merge user statuses and episode progress from all responses
  const userStatuses = mergeMaps(
    trendingData?.userStatuses,
    upcomingSeriesData?.userStatuses,
    upcomingMoviesData?.userStatuses,
    popularTvData?.userStatuses,
    popularMoviesData?.userStatuses,
  );
  const episodeProgress = mergeMaps(
    trendingData?.episodeProgress,
    upcomingSeriesData?.episodeProgress,
    upcomingMoviesData?.episodeProgress,
    popularTvData?.episodeProgress,
    popularMoviesData?.episodeProgress,
  );

  return (
    <div className="space-y-6">
      <DiscoverSearchBar />

      {hero && (
        <HeroBanner
          id={hero.id}
          type={hero.type}
          title={hero.title}
          overview={hero.overview}
          backdropPath={hero.backdropPath}
          voteAverage={hero.voteAverage}
        />
      )}

      {/* Order per Sid's list (24.08): Tendance, Séries à venir, Films à
          venir, Séries populaires, Films populaires, Découvrir. */}

      <div>
        <TitleRow
          heading={t`Trending Today`}
          icon={<IconFlame aria-hidden={true} className="text-primary size-5" />}
          items={trendingItems}
          userStatuses={userStatuses}
          episodeProgress={episodeProgress}
        />
      </div>

      <TitleRow
        heading={t`Upcoming Series`}
        icon={<IconCalendarPlus aria-hidden={true} className="text-primary size-5" />}
        items={upcomingSeriesData?.items ?? []}
        userStatuses={userStatuses}
        episodeProgress={episodeProgress}
      />

      <TitleRow
        heading={t`Upcoming Movies`}
        icon={<IconCalendarPlus aria-hidden={true} className="text-primary size-5" />}
        items={upcomingMoviesData?.items ?? []}
        userStatuses={userStatuses}
        episodeProgress={episodeProgress}
      />

      <FilterableTitleRow
        heading={t`Popular TV Shows`}
        icon={<IconDeviceTv aria-hidden={true} className="text-primary size-5" />}
        mediaType="tv"
        defaultItems={popularTvData?.items ?? []}
        genres={tvGenreData?.genres ?? []}
        userStatuses={userStatuses}
        episodeProgress={episodeProgress}
      />

      <FilterableTitleRow
        heading={t`Popular Movies`}
        icon={<IconMovie aria-hidden={true} className="text-primary size-5" />}
        mediaType="movie"
        defaultItems={popularMoviesData?.items ?? []}
        genres={movieGenreData?.genres ?? []}
        userStatuses={userStatuses}
        episodeProgress={episodeProgress}
      />

      <DiscoverSection search={discoverSearch} onSearchChange={navigate} />
    </div>
  );
}
