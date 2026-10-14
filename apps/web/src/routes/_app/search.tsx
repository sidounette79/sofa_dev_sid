import { useLingui } from "@lingui/react/macro";
import { IconSearchOff } from "@tabler/icons-react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { useMemo } from "react";
import { z } from "zod";

import { TitleGrid, TitleGridSectionSkeleton } from "@/components/dashboard/title-grid";
import { TitleList } from "@/components/dashboard/title-list";
import { RouteError } from "@/components/route-error";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { getPersistedViewMode } from "@/lib/appearance";
import { orpc } from "@/lib/orpc/client";

const searchPageSchema = z.object({
  q: z.string().optional().catch(undefined),
  type: z.enum(["movie", "tv"]).optional().catch(undefined),
});

export const Route = createFileRoute("/_app/search")({
  validateSearch: zodValidator(searchPageSchema),
  head: () => ({ meta: [{ title: "Search — Patoune TV" }] }),
  errorComponent: RouteError,
  component: SearchPage,
});

function SearchPage() {
  const { t } = useLingui();
  const { q, type } = Route.useSearch();
  const trimmedQuery = q?.trim() ?? "";
  const viewMode = getPersistedViewMode();

  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    orpc.discover.search.infiniteOptions({
      input: (pageParam: number) => ({ query: trimmedQuery, type, page: pageParam }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) =>
        lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
      maxPages: 20,
      enabled: trimmedQuery.length > 0,
    }),
  );

  const items = useMemo(
    () =>
      (data?.pages.flatMap((p) => p.results) ?? []).filter(
        (r): r is typeof r & { id: string } => r.type !== "person" && !!r.id,
      ),
    [data?.pages],
  );
  const totalResults = data?.pages[0]?.totalResults ?? 0;

  const sentinelRef = useInfiniteScroll({
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl tracking-tight">
          {trimmedQuery ? t`Results for "${trimmedQuery}"` : t`Search`}
        </h1>
        {trimmedQuery && !isPending && (
          <p className="text-muted-foreground mt-1 text-sm">
            {t`${totalResults} results from TMDB`}
          </p>
        )}
      </div>

      {!trimmedQuery ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <IconSearchOff className="text-muted-foreground/40 size-12" />
          <p className="text-muted-foreground text-lg">{t`Type something to search`}</p>
        </div>
      ) : isPending ? (
        <TitleGridSectionSkeleton />
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <IconSearchOff className="text-muted-foreground/40 size-12" />
          <p className="text-muted-foreground text-lg">{t`No results found`}</p>
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
