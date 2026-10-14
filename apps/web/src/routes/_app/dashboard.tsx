import { createFileRoute } from "@tanstack/react-router";

import { AvailableEmbySection } from "@/components/dashboard/available-emby-section";
import { CaughtUpSection } from "@/components/dashboard/caught-up-section";
import { CompletedSeriesSection } from "@/components/dashboard/completed-series-section";
import { LibrarySection } from "@/components/dashboard/library-section";
import { NowPlayingSection } from "@/components/dashboard/now-playing-section";
import { RecommendationsSection } from "@/components/dashboard/recommendations-section";
import { ToWatchSection } from "@/components/dashboard/to-watch-section";
import { TitleGridSectionSkeleton } from "@/components/dashboard/title-grid";
import { WelcomeHeader } from "@/components/dashboard/welcome-header";
import { RouteError } from "@/components/route-error";
import { Skeleton } from "@/components/ui/skeleton";
import { withLoaderRetry } from "@/lib/loader-retry";
import { orpc } from "@/lib/orpc/client";

export const Route = createFileRoute("/_app/dashboard")({
  staleTime: 30_000,
  loader: async ({ context }) => {
    await withLoaderRetry(() =>
      Promise.all([
        context.queryClient.ensureQueryData(
          orpc.library.continueWatching.queryOptions({
            input: { sortBy: "watched", sortDirection: "desc" },
          }),
        ),
        context.queryClient.ensureQueryData(orpc.library.nowPlaying.queryOptions()),
        context.queryClient.ensureQueryData(orpc.discover.recommendations.queryOptions({ input: {} })),
        context.queryClient.ensureQueryData(
          orpc.discover.untrackedEmbyLibrary.queryOptions({ input: {} }),
        ),
        context.queryClient.ensureQueryData(
          orpc.library.list.queryOptions({ input: { page: 1, limit: 10 } }),
        ),
        context.queryClient.ensureQueryData(
          orpc.library.list.queryOptions({
            input: { page: 1, limit: 10, statuses: ["in_watchlist"] },
          }),
        ),
      ]),
    );
  },
  head: () => ({ meta: [{ title: "Dashboard — Patoune TV" }] }),
  pendingComponent: DashboardSkeleton,
  errorComponent: RouteError,
  component: DashboardPage,
});

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-48" />
      </div>
      <TitleGridSectionSkeleton />
      <TitleGridSectionSkeleton />
      <TitleGridSectionSkeleton />
    </div>
  );
}

function DashboardPage() {
  const { session } = Route.useRouteContext();
  return (
    <div className="space-y-6">
      <WelcomeHeader name={session.user.name} />
      <NowPlayingSection />
      <ToWatchSection />
      <CaughtUpSection />
      <CompletedSeriesSection />
      <LibrarySection />
      <RecommendationsSection />
      <AvailableEmbySection />
    </div>
  );
}
