import { useLingui } from "@lingui/react/macro";
import { IconServer2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc/client";
import { FeedSection } from "./feed-section";
import { TitleGrid, TitleGridSectionSkeleton } from "./title-grid";

export function AvailableEmbySection({ type }: { type?: "movie" | "tv" } = {}) {
  const { data, isPending } = useQuery(
    orpc.discover.untrackedEmbyLibrary.queryOptions({ input: { type } }),
  );
  const { t } = useLingui();
  if (isPending) return <TitleGridSectionSkeleton />;
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <FeedSection
      id={`available-emby-${type ?? "all"}`}
      collapsible
      defaultOpen
      title={t`Available — Not Tracked`}
      countLabel={`(${data?.totalResults ?? items.length})`}
      icon={<IconServer2 className="text-primary size-5" />}
    >
      <TitleGrid items={items} />
    </FeedSection>
  );
}
