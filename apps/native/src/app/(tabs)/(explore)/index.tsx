import { useLingui } from "@lingui/react/macro";
import { IconDeviceTv, IconFlame, IconMovie, IconTrophy } from "@tabler/icons-react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { FilterableTitleRow } from "@/components/explore/filterable-title-row";
import { HeroBanner } from "@/components/explore/hero-banner";
import { orpc } from "@/lib/orpc";
import { queryClient } from "@/lib/query-client";

const exploreContentContainerStyle = {
  paddingTop: 8,
  paddingBottom: 16,
};

export default function ExploreScreen() {
  const { t } = useLingui();
  const currentYear = new Date().getFullYear();
  const trending = useInfiniteQuery(
    orpc.discover.trending.infiniteOptions({
      input: (pageParam: number) => ({ type: "all" as const, page: pageParam }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) =>
        lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
      maxPages: 10,
    }),
  );
  // 17.10, Sid: "après tendance du jour, la tendance de la semaine"
  const weeklyTrending = useInfiniteQuery(
    orpc.discover.trending.infiniteOptions({
      input: (pageParam: number) => ({
        type: "all" as const,
        page: pageParam,
        timeWindow: "week" as const,
      }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) =>
        lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
      maxPages: 10,
    }),
  );
  // 17.10, Sid: "nouvel onglet dans découvrir avec les tops films de
  // l'année selon tmdb" — no input, the server derives "this year" itself.
  const topMoviesOfYear = useQuery(orpc.discover.topMoviesOfYear.queryOptions());
  const popularMovies = useQuery(orpc.discover.popular.queryOptions({ input: { type: "movie" } }));
  const popularTv = useQuery(orpc.discover.popular.queryOptions({ input: { type: "tv" } }));
  const movieGenres = useQuery(orpc.discover.genres.queryOptions({ input: { type: "movie" } }));
  const tvGenres = useQuery(orpc.discover.genres.queryOptions({ input: { type: "tv" } }));

  const isRefreshing =
    trending.isRefetching ||
    weeklyTrending.isRefetching ||
    topMoviesOfYear.isRefetching ||
    popularMovies.isRefetching ||
    popularTv.isRefetching;

  const onRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: orpc.discover.key() });
  }, []);

  const heroItem = trending.data?.pages[0]?.hero ?? null;

  const trendingItems = useMemo(
    () => trending.data?.pages.flatMap((p) => p.items) ?? [],
    [trending.data?.pages],
  );
  const trendingStatuses = useMemo(
    () =>
      Object.assign({}, ...(trending.data?.pages.map((p) => p.userStatuses) ?? [])) as Record<
        string,
        "in_watchlist" | "watching" | "caught_up" | "completed"
      >,
    [trending.data?.pages],
  );
  const trendingProgress = useMemo(
    () =>
      Object.assign({}, ...(trending.data?.pages.map((p) => p.episodeProgress) ?? [])) as Record<
        string,
        { watched: number; total: number }
      >,
    [trending.data?.pages],
  );

  const weeklyTrendingItems = useMemo(
    () => weeklyTrending.data?.pages.flatMap((p) => p.items) ?? [],
    [weeklyTrending.data?.pages],
  );
  const weeklyTrendingStatuses = useMemo(
    () =>
      Object.assign({}, ...(weeklyTrending.data?.pages.map((p) => p.userStatuses) ?? [])) as Record<
        string,
        "in_watchlist" | "watching" | "caught_up" | "completed"
      >,
    [weeklyTrending.data?.pages],
  );
  const weeklyTrendingProgress = useMemo(
    () =>
      Object.assign(
        {},
        ...(weeklyTrending.data?.pages.map((p) => p.episodeProgress) ?? []),
      ) as Record<string, { watched: number; total: number }>,
    [weeklyTrending.data?.pages],
  );

  return (
    <ScrollView
      className="bg-background"
      contentContainerStyle={exploreContentContainerStyle}
      contentInsetAdjustmentBehavior="automatic"
      scrollToOverflowEnabled
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
    >
      <View className="gap-8">
        {heroItem && <HeroBanner item={heroItem} />}

        <Animated.View entering={FadeInDown.duration(300).delay(100)}>
          <FilterableTitleRow
            title={t`Trending Today`}
            icon={IconFlame}
            mediaType="movie"
            defaultItems={trendingItems}
            defaultUserStatuses={trendingStatuses}
            defaultEpisodeProgress={trendingProgress}
            isLoading={trending.isPending}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(150)}>
          <FilterableTitleRow
            title={t`Trending This Week`}
            icon={IconFlame}
            mediaType="movie"
            defaultItems={weeklyTrendingItems}
            defaultUserStatuses={weeklyTrendingStatuses}
            defaultEpisodeProgress={weeklyTrendingProgress}
            isLoading={weeklyTrending.isPending}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(175)}>
          <FilterableTitleRow
            title={t`Top Movies of ${currentYear}`}
            icon={IconTrophy}
            mediaType="movie"
            defaultItems={topMoviesOfYear.data?.items ?? []}
            defaultUserStatuses={topMoviesOfYear.data?.userStatuses ?? {}}
            defaultEpisodeProgress={topMoviesOfYear.data?.episodeProgress ?? {}}
            isLoading={topMoviesOfYear.isPending}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(200)}>
          <FilterableTitleRow
            title={t`Popular Movies`}
            icon={IconMovie}
            mediaType="movie"
            defaultItems={popularMovies.data?.items ?? []}
            defaultUserStatuses={popularMovies.data?.userStatuses ?? {}}
            defaultEpisodeProgress={popularMovies.data?.episodeProgress ?? {}}
            genres={movieGenres.data?.genres}
            isLoading={popularMovies.isPending}
          />
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(300).delay(300)}>
          <FilterableTitleRow
            title={t`Popular TV Shows`}
            icon={IconDeviceTv}
            mediaType="tv"
            defaultItems={popularTv.data?.items ?? []}
            defaultUserStatuses={popularTv.data?.userStatuses ?? {}}
            defaultEpisodeProgress={popularTv.data?.episodeProgress ?? {}}
            genres={tvGenres.data?.genres}
            isLoading={popularTv.isPending}
          />
        </Animated.View>
      </View>
    </ScrollView>
  );
}
