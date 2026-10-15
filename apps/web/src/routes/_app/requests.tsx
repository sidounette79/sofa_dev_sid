import { Trans, useLingui } from "@lingui/react/macro";
import { IconClockHour4, IconInbox } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { TitleGrid, TitleGridSectionSkeleton } from "@/components/dashboard/title-grid";
import { RouteError } from "@/components/route-error";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { withLoaderRetry } from "@/lib/loader-retry";
import { orpc } from "@/lib/orpc/client";

// 15.10, Sid - "la potentielle page qui recenserait toutes les demandes en
// attente": deferred 30.08 in favor of tracking via Radarr/Sonarr tags,
// reopened at her explicit request now that requestedAt/requestedByUserId
// already exist on titles. No mobile tab (bottom bar is already full at 6)
// - reachable from Settings on mobile, a real nav tab on desktop.
const PAGE_SIZE = 40;

const requestsSearchSchema = z.object({
  pendingOnly: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute("/_app/requests")({
  validateSearch: zodValidator(requestsSearchSchema),
  staleTime: 30_000,
  loaderDeps: ({ search }) => ({ pendingOnly: search.pendingOnly ?? true }),
  loader: async ({ context, deps }) => {
    await withLoaderRetry(() =>
      context.queryClient.ensureInfiniteQueryData(
        orpc.mediaRequests.listRequested.infiniteOptions({
          input: (page: number | undefined) => ({
            pendingOnly: deps.pendingOnly,
            page: page ?? 1,
            limit: PAGE_SIZE,
          }),
          initialPageParam: 1,
          getNextPageParam: (lastPage, pages) =>
            pages.length * PAGE_SIZE < lastPage.total ? pages.length + 1 : undefined,
        }),
      ),
    );
  },
  head: () => ({ meta: [{ title: "Requests — Patoune TV" }] }),
  pendingComponent: RequestsSkeleton,
  errorComponent: RouteError,
  component: RequestsPage,
});

function RequestsSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <div className="bg-muted size-5 animate-pulse rounded" />
        <div className="bg-muted h-8 w-40 animate-pulse rounded" />
      </div>
      <TitleGridSectionSkeleton />
    </div>
  );
}

function RequestsPage() {
  const { t } = useLingui();
  const navigate = Route.useNavigate();
  const { pendingOnly = true } = Route.useSearch();

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = useInfiniteQuery(
    orpc.mediaRequests.listRequested.infiniteOptions({
      input: (page: number | undefined) => ({
        pendingOnly,
        page: page ?? 1,
        limit: PAGE_SIZE,
      }),
      initialPageParam: 1,
      getNextPageParam: (lastPage, pages) =>
        pages.length * PAGE_SIZE < lastPage.total ? pages.length + 1 : undefined,
    }),
  );

  const sentinelRef = useInfiniteScroll({
    fetchNextPage,
    hasNextPage: !!hasNextPage,
    isFetchingNextPage,
  });

  if (isPending) return <RequestsSkeleton />;

  const items = data?.pages.flatMap((p) => p.items) ?? [];
  const total = data?.pages[0]?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <IconClockHour4 aria-hidden={true} className="text-muted-foreground size-5" />
          <h1 className="font-display text-2xl tracking-tight sm:text-3xl">
            <Trans>Requests</Trans>
          </h1>
        </div>
        <ToggleGroup
          value={[pendingOnly ? "pending" : "all"]}
          onValueChange={(values) => {
            const next = values[0];
            void navigate({
              search: { pendingOnly: next === "all" ? false : undefined },
            });
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="pending">{t`Pending`}</ToggleGroupItem>
          <ToggleGroupItem value="all">{t`All history`}</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {items.length === 0 ? (
        <div className="text-muted-foreground flex flex-col items-center gap-3 py-24 text-center">
          <IconInbox aria-hidden={true} className="size-10 opacity-50" />
          <p className="text-sm">
            {pendingOnly ? (
              <Trans>Nothing pending — every request has been fulfilled.</Trans>
            ) : (
              <Trans>No requests yet.</Trans>
            )}
          </p>
        </div>
      ) : (
        <>
          <TitleGrid items={items} />
          <div ref={sentinelRef} className="h-px" />
        </>
      )}

      <p className="text-muted-foreground text-center text-xs">
        {items.length} / {total}
      </p>
    </div>
  );
}
