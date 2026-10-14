import { useLingui } from "@lingui/react/macro";
import { IconChartBar, IconCheck, IconDeviceTv, IconMovie } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { StatsDisplay, StatsSectionSkeleton } from "@/components/dashboard/stats-display";
import { DonutChart } from "@/components/statistics/donut-chart";
import { StackedBar } from "@/components/statistics/stacked-bar";
import { Skeleton } from "@/components/ui/skeleton";
import { translateGenreName } from "@/lib/genre-names";
import { withLoaderRetry } from "@/lib/loader-retry";
import { orpc } from "@/lib/orpc/client";

export const Route = createFileRoute("/_app/statistics")({
  loader: async ({ context }) => {
    await withLoaderRetry(() =>
      Promise.all([
        context.queryClient.ensureQueryData(orpc.library.statistics.queryOptions()),
        context.queryClient.ensureQueryData(
          orpc.tracking.stats.queryOptions({ input: { type: "movie", period: "this_month" } }),
        ),
        context.queryClient.ensureQueryData(
          orpc.tracking.stats.queryOptions({ input: { type: "episode", period: "this_week" } }),
        ),
        context.queryClient.ensureQueryData(orpc.library.stats.queryOptions()),
      ]),
    );
  },
  head: () => ({ meta: [{ title: "Statistics — Patoune TV" }] }),
  component: StatisticsPage,
});

function LiveStatsSection() {
  const { data: movieStats, isPending: moviesPending } = useQuery(
    orpc.tracking.stats.queryOptions({ input: { type: "movie", period: "this_month" } }),
  );
  const { data: episodeStats, isPending: episodesPending } = useQuery(
    orpc.tracking.stats.queryOptions({ input: { type: "episode", period: "this_week" } }),
  );
  const { data: libraryStats, isPending: libraryPending } = useQuery(
    orpc.library.stats.queryOptions(),
  );

  if (moviesPending || episodesPending || libraryPending) return <StatsSectionSkeleton />;
  if (!movieStats || !episodeStats || !libraryStats) return null;

  return (
    <StatsDisplay movieStats={movieStats} episodeStats={episodeStats} libraryStats={libraryStats} />
  );
}

// 25.08, Sid: "en tout... histoire de faire peur" — days once it's big
// enough to be impressive, hours below that.
function formatWatchTime(totalMinutes: number) {
  const hours = Math.round(totalMinutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}j ${remainingHours}h`;
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="border-border/30 bg-card/50 overflow-hidden rounded-xl border p-4">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium tracking-wide uppercase">
        {icon}
        {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function StatisticsPage() {
  const { t } = useLingui();
  const { data, isPending } = useQuery(orpc.library.statistics.queryOptions());

  if (isPending || !data) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <IconChartBar aria-hidden={true} className="text-primary size-5" />
          <h1 className="font-display text-xl tracking-tight">{t`Statistics`}</h1>
        </div>
        <LiveStatsSection />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const statusLabels = {
    in_watchlist: t`Watchlist`,
    watching: t`Watching`,
    caught_up: t`Caught Up`,
    completed: t`Completed`,
    dropped: t`Dropped`,
  } as const;

  const statusColors = {
    in_watchlist: "text-sky-400",
    watching: "text-amber-400",
    caught_up: "text-violet-400",
    completed: "text-emerald-400",
    dropped: "text-rose-500",
  } as const;

  const statusSegments = (
    Object.keys(statusLabels) as Array<keyof typeof statusLabels>
  ).map((key) => ({
    label: statusLabels[key],
    value: data.statusDistribution[key],
    colorClass: statusColors[key],
  }));

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-2">
        <IconChartBar aria-hidden={true} className="text-primary size-5" />
        <h1 className="font-display text-xl tracking-tight">{t`Statistics`}</h1>
      </div>

      <LiveStatsSection />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          icon={<IconMovie className="size-3.5" />}
          label={t`Movies Watched`}
          value={data.totalMoviesWatched}
        />
        <StatCard
          icon={<IconDeviceTv className="size-3.5" />}
          label={t`Episodes Watched`}
          value={data.totalEpisodesWatched}
        />
        <StatCard
          icon={<IconCheck className="size-3.5" />}
          label={t`In Library`}
          value={data.librarySize}
        />
        <StatCard
          icon={<IconMovie className="size-3.5" />}
          label={t`Time Watching Movies`}
          value={formatWatchTime(data.totalWatchTimeMinutes.movie)}
        />
        <StatCard
          icon={<IconDeviceTv className="size-3.5" />}
          label={t`Time Watching TV`}
          value={formatWatchTime(data.totalWatchTimeMinutes.tv)}
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="border-border/30 bg-card/50 rounded-xl border p-5">
          <h2 className="mb-4 text-sm font-medium">{t`Media Type Distribution`}</h2>
          <DonutChart
            segments={[
              { label: t`Movies`, value: data.mediaTypeDistribution.movie, colorClass: "text-amber-400" },
              { label: t`TV Shows`, value: data.mediaTypeDistribution.tv, colorClass: "text-sky-400" },
            ]}
          />
        </div>
        <div className="border-border/30 bg-card/50 rounded-xl border p-5">
          <h2 className="mb-4 text-sm font-medium">{t`Status Distribution`}</h2>
          <DonutChart segments={statusSegments} />
        </div>
      </div>

      <div className="border-border/30 bg-card/50 space-y-4 rounded-xl border p-5">
        <h2 className="text-sm font-medium">{t`Status Breakdown by Type`}</h2>
        <StackedBar
          rowLabel={t`Movies`}
          segments={(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map((key) => ({
            label: statusLabels[key],
            value: data.statusByType.movie[key],
            colorClass: statusColors[key],
          }))}
        />
        <StackedBar
          rowLabel={t`TV Shows`}
          segments={(Object.keys(statusLabels) as Array<keyof typeof statusLabels>).map((key) => ({
            label: statusLabels[key],
            value: data.statusByType.tv[key],
            colorClass: statusColors[key],
          }))}
        />
      </div>

      {data.genreStats.length > 0 && (
        <div className="border-border/30 bg-card/50 rounded-xl border p-5">
          <h2 className="mb-4 text-sm font-medium">{t`Genres Watched`}</h2>
          <div className="space-y-2.5">
            {data.genreStats.slice(0, 10).map((genre) => {
              const maxCount = data.genreStats[0]?.count ?? 1;
              const pct = maxCount > 0 ? (genre.count / maxCount) * 100 : 0;
              return (
                <div key={genre.name} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-sm">
                    {translateGenreName(genre.name)}
                  </span>
                  <div className="bg-muted/50 h-2 flex-1 overflow-hidden rounded-full">
                    <div
                      className="bg-primary h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-muted-foreground w-6 shrink-0 text-right text-xs tabular-nums">
                    {genre.count}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
