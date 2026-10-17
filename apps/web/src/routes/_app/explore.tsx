import { Trans, useLingui } from "@lingui/react/macro";
import {
  IconCalendarPlus,
  IconChevronRight,
  IconDeviceTv,
  IconFlame,
  IconMovie,
  IconSearch,
  IconTrophy,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { DiscoverSearchBar } from "@/components/explore/discover-search-bar";
import { FilterableTitleRow } from "@/components/explore/filterable-title-row";
import { HeroBanner } from "@/components/explore/hero-banner";
import { TitleRow } from "@/components/explore/title-row";
import { RouteError } from "@/components/route-error";
import { Skeleton } from "@/components/ui/skeleton";
import { withLoaderRetry } from "@/lib/loader-retry";
import { orpc } from "@/lib/orpc/client";

export const Route = createFileRoute("/_app/explore")({
  staleTime: 60_000,
  loader: async ({ context }) => {
    await withLoaderRetry(() =>
      Promise.all([
        context.queryClient.ensureQueryData(
          orpc.discover.trending.queryOptions({ input: { type: "all", page: 1 } }),
        ),
        context.queryClient.ensureQueryData(
          orpc.discover.trending.queryOptions({
            input: { type: "all", page: 1, timeWindow: "week" },
          }),
        ),
        context.queryClient.ensureQueryData(orpc.discover.topMoviesOfYear.queryOptions()),
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
  const { data: trendingData, isPending: trendingPending } = useQuery(
    orpc.discover.trending.queryOptions({ input: { type: "all", page: 1 } }),
  );
  const { data: weeklyTrendingData, isPending: weeklyTrendingPending } = useQuery(
    orpc.discover.trending.queryOptions({
      input: { type: "all", page: 1, timeWindow: "week" },
    }),
  );
  const { data: topMoviesOfYearData, isPending: topMoviesOfYearPending } = useQuery(
    orpc.discover.topMoviesOfYear.queryOptions(),
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
    trendingPending ||
    weeklyTrendingPending ||
    topMoviesOfYearPending ||
    upcomingSeriesPending ||
    upcomingMoviesPending ||
    tvPending ||
    moviesPending;

  const trendingItems = trendingData?.items ?? [];
  const weeklyTrendingItems = weeklyTrendingData?.items ?? [];
  const topMoviesOfYearItems = topMoviesOfYearData?.items ?? [];
  const currentYear = new Date().getFullYear();
  const hero = trendingData?.hero ?? null;

  if (isPending) return <ExploreSkeletons />;

  // Merge user statuses and episode progress from all responses
  const userStatuses = mergeMaps(
    trendingData?.userStatuses,
    weeklyTrendingData?.userStatuses,
    topMoviesOfYearData?.userStatuses,
    upcomingSeriesData?.userStatuses,
    upcomingMoviesData?.userStatuses,
    popularTvData?.userStatuses,
    popularMoviesData?.userStatuses,
  );
  const episodeProgress = mergeMaps(
    trendingData?.episodeProgress,
    weeklyTrendingData?.episodeProgress,
    topMoviesOfYearData?.episodeProgress,
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

      {/* Order per Sid's list (17.10): Tendance du jour, Tendance de la
          semaine, Séries à venir, Films à venir, Top de l'année, Découvrir
          (nav card, own page), Séries populaires, Films populaires. */}

      <div>
        <TitleRow
          id="trending-today"
          heading={t`Trending Today`}
          icon={<IconFlame aria-hidden={true} className="text-primary size-5" />}
          items={trendingItems}
          userStatuses={userStatuses}
          episodeProgress={episodeProgress}
        />
      </div>

      <TitleRow
        id="trending-week"
        heading={t`Trending This Week`}
        icon={<IconFlame aria-hidden={true} className="text-primary size-5" />}
        items={weeklyTrendingItems}
        userStatuses={userStatuses}
        episodeProgress={episodeProgress}
      />

      <TitleRow
        id="upcoming-series"
        heading={t`Upcoming Series`}
        icon={<IconCalendarPlus aria-hidden={true} className="text-primary size-5" />}
        items={upcomingSeriesData?.items ?? []}
        userStatuses={userStatuses}
        episodeProgress={episodeProgress}
      />

      <TitleRow
        id="upcoming-movies"
        heading={t`Upcoming Movies`}
        icon={<IconCalendarPlus aria-hidden={true} className="text-primary size-5" />}
        items={upcomingMoviesData?.items ?? []}
        userStatuses={userStatuses}
        episodeProgress={episodeProgress}
      />

      <TitleRow
        id="top-movies-of-year"
        heading={t`Top Movies of ${currentYear}`}
        icon={<IconTrophy aria-hidden={true} className="text-primary size-5" />}
        items={topMoviesOfYearItems}
        userStatuses={userStatuses}
        episodeProgress={episodeProgress}
      />

      {/* 17.10, Sid: "ou est-ce qu'on fait peut-être des sous-pages
          dédiées?" — Discover is a real filtering tool over an infinite-
          scrolling catalog, not a capped row; it used to sit embedded here,
          always fully expanded, blocking Populaires below it from ever
          being reachable. Own page now (/explore/discover), linked from
          here instead.
          17.10, round 2, Sid ("le découvrir me renvoie sur la page
          découvrir et pas sur la page globale avec filtre de genres"):
          the nav bar's own top-level "Découvrir" tab (nav-bar.tsx) already
          points at /explore - labeling this card "Discover" too meant two
          different destinations shared the exact same French label.
          Distinct label now ("Recherche avancée"), same destination. */}
      <Link
        to="/explore/discover"
        className="ring-foreground/10 hover:bg-card/50 flex items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium ring-1 transition-colors"
      >
        <span className="flex items-center gap-2">
          <IconSearch aria-hidden={true} className="text-primary size-5" />
          <Trans>Advanced Search</Trans>
        </span>
        <IconChevronRight aria-hidden={true} className="text-muted-foreground size-4" />
      </Link>

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
    </div>
  );
}
