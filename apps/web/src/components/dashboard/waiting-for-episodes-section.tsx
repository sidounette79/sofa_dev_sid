import { useLingui } from "@lingui/react/macro";
import { IconHourglassEmpty } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc/client";
import { FeedSection } from "./feed-section";
import { TitleGrid, TitleGridSectionSkeleton } from "./title-grid";

/**
 * Séries page section (24.08, Sid) — the counterpart of ToWatchSection's
 * availability fix: a watchlisted show with zero downloaded episodes used to
 * show up in "To Watch" as if it were ready to watch (real bug, fixed by
 * filtering ToWatchSection to embyStatus === "available"). Once filtered
 * out, those shows had nowhere to go at all — Sid asked for a real home for
 * them ("il faudrait une rubrique en attente d'épisode"). Same query as
 * ToWatchSection's watchlist half, opposite filter.
 */
export function WaitingForEpisodesSection() {
  const { data, isPending } = useQuery(
    orpc.library.list.queryOptions({
      // 26.08, Sid — the embyStatus split happens client-side (library.list
      // has no server-side embyStatus filter), so limit:20 could silently
      // truncate the "waiting" set before this component ever saw the
      // truncated-out items — a generous cap keeps items.length accurate as
      // the header count instead of an artifact of the fetch page size.
      input: { page: 1, limit: 500, statuses: ["in_watchlist"], type: "tv" },
    }),
  );
  const { t } = useLingui();
  if (isPending) return <TitleGridSectionSkeleton />;
  const items = (data?.items ?? []).filter((item) => item.embyStatus !== "available");
  if (items.length === 0) return null;
  return (
    <FeedSection
      id="waiting-for-episodes"
      title={t`Waiting — Not Available`}
      icon={<IconHourglassEmpty className="text-primary size-5" />}
      seeAllLink="/library"
      seeAllSearch={{ type: "tv", statuses: ["in_watchlist"] }}
      collapsible
      defaultOpen
      countLabel={`(${items.length})`}
    >
      <TitleGrid items={items} />
    </FeedSection>
  );
}
