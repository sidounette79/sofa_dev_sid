import { useLingui } from "@lingui/react/macro";
import { IconTrash } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc/client";
import { FeedSection } from "./feed-section";
import { TitleGrid, TitleGridSectionSkeleton } from "./title-grid";

/** Séries page section (24.08, Sid) — mirrors CompletedSeriesSection, collapsed by default. */
export function DroppedSeriesSection() {
  const { data, isPending } = useQuery(
    orpc.library.list.queryOptions({
      input: { page: 1, limit: 20, statuses: ["dropped"], type: "tv" },
    }),
  );
  const { t } = useLingui();
  if (isPending) return <TitleGridSectionSkeleton />;
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <FeedSection
      id="dropped-series"
      title={t`Dropped`}
      icon={<IconTrash className="text-primary size-5" />}
      seeAllLink="/library"
      seeAllSearch={{ type: "tv", statuses: ["dropped"] }}
      collapsible
      defaultOpen={false}
      countLabel={`(${data?.totalResults ?? items.length})`}
    >
      <TitleGrid items={items} />
    </FeedSection>
  );
}
