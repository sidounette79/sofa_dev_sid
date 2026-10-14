import { useLingui } from "@lingui/react/macro";
import { IconCircleCheck } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc/client";
import { FeedSection } from "./feed-section";
import { TitleGrid, TitleGridSectionSkeleton } from "./title-grid";

export function CompletedSeriesSection() {
  const { data, isPending } = useQuery(
    orpc.library.list.queryOptions({
      input: { page: 1, limit: 20, statuses: ["completed"], type: "tv" },
    }),
  );
  const { t } = useLingui();
  if (isPending) return <TitleGridSectionSkeleton />;
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <FeedSection
      id="completed-series"
      title={t`Completed Series`}
      icon={<IconCircleCheck className="text-primary size-5" />}
      seeAllLink="/library"
      seeAllSearch={{ type: "tv", statuses: ["completed"] }}
      collapsible
      defaultOpen={false}
      countLabel={`(${data?.totalResults ?? items.length})`}
    >
      <TitleGrid items={items} />
    </FeedSection>
  );
}
