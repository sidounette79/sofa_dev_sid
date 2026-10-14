import { useLingui } from "@lingui/react/macro";
import { IconCalendarEvent } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc/client";
import { FeedSection } from "./feed-section";
import { TitleGrid, TitleGridSectionSkeleton } from "./title-grid";

/**
 * Small-card version of the /upcoming page's list rows, embedded as a Séries
 * page section (24.08, Sid: "en format petite carte et pas en liste comme
 * sur la page à venir, qu'on pourrait du coup supprimer"). Reuses TitleCard
 * (via TitleGrid) — the upcoming item shape already matches its props
 * (titleId/titleName/titleType/posterPath/date -> id/title/type/posterPath/
 * releaseDate) one-to-one, no new card component needed.
 */
export function UpcomingCardsSection({ type }: { type?: "movie" | "tv" } = {}) {
  const { data, isPending } = useQuery(
    orpc.library.upcoming.queryOptions({
      input: { days: 90, limit: 20, mediaType: type },
    }),
  );
  const { t } = useLingui();
  if (isPending) return <TitleGridSectionSkeleton />;
  const items = (data?.items ?? []).map((item) => ({
    id: item.titleId,
    type: item.titleType,
    title: item.titleName,
    posterPath: item.posterPath,
    posterThumbHash: item.posterThumbHash,
    releaseDate: item.date,
  }));
  if (items.length === 0) return null;
  return (
    <FeedSection
      id="upcoming-cards"
      title={t`Upcoming Releases`}
      icon={<IconCalendarEvent className="text-primary size-5" />}
      seeAllLink="/upcoming"
      seeAllSearch={type ? { type } : undefined}
      collapsible
      defaultOpen
      countLabel={`(${data?.totalResults ?? items.length})`}
    >
      <TitleGrid items={items} />
    </FeedSection>
  );
}
