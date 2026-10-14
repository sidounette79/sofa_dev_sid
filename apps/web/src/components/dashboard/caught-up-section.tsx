import { useLingui } from "@lingui/react/macro";
import { IconClockPause } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc/client";
import { FeedSection } from "./feed-section";
import { TitleGrid, TitleGridSectionSkeleton } from "./title-grid";

export function CaughtUpSection() {
  const { data, isPending } = useQuery(
    orpc.library.list.queryOptions({
      input: { page: 1, limit: 10, statuses: ["caught_up"] },
    }),
  );
  const { t } = useLingui();
  if (isPending) return <TitleGridSectionSkeleton />;
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <FeedSection
      id="caught-up"
      collapsible
      defaultOpen
      title={t`Followed — Up to Date`}
      countLabel={`(${data?.totalResults ?? items.length})`}
      icon={<IconClockPause className="text-primary size-5" />}
      seeAllLink="/library"
      seeAllSearch={{ type: "tv", statuses: ["caught_up"] }}
    >
      <TitleGrid items={items} />
    </FeedSection>
  );
}
