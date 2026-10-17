import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { z } from "zod";

import { DiscoverSection } from "@/components/explore/discover-section";
import { RouteError } from "@/components/route-error";
import { Skeleton } from "@/components/ui/skeleton";

// 17.10, Sid: "ou est-ce qu'on fait peut-être des sous-pages dédiées?" —
// moved out of explore.tsx (where it used to sit embedded, always fully
// expanded, at the bottom of the page) into its own route. It's a real
// filtering tool (genre/decade/rating/sort/language/provider) over an
// infinite-scrolling TMDB catalog, not a capped row like the others — fine
// as the last thing on a page, genuinely in the way once rows were meant
// to come after it (Populaires). Same discoverSearchSchema that used to
// live on /explore, moved here with it: these filters are this page's own
// state now, /explore no longer needs them.
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

export const Route = createFileRoute("/_app/explore_/discover")({
  staleTime: 60_000,
  validateSearch: zodValidator(discoverSearchSchema),
  head: () => ({ meta: [{ title: "Discover — Patoune TV" }] }),
  pendingComponent: DiscoverPageSkeleton,
  errorComponent: RouteError,
  component: DiscoverPage,
});

function DiscoverPageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Skeleton className="size-5 rounded" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[2/3] w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function DiscoverPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  // DiscoverSection renders its own FeedSection header ("Discover" + the
  // search icon) — no separate page h1 here, that would just duplicate it.
  return <DiscoverSection search={search} onSearchChange={navigate} />;
}
