import { useLingui } from "@lingui/react/macro";
import { IconDownload } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc/client";
import { FeedSection } from "./feed-section";
import { TitleGrid, TitleGridSectionSkeleton } from "./title-grid";

/**
 * "Demandé - pas dispo" (24.08, Sid) — replaces the earlier
 * WaitingForEpisodesSection attempt, which mixed "coming soon" with "no idea
 * if/when ever" and felt more confusing than useful. This one is narrower on
 * purpose: only titles with a real Radarr/Sonarr request behind them
 * (titles.requestedAt, set by media-requests.ts's Request button or the
 * hourly reconciliation sync — see project_sofa_radarr_sonarr_folder_picker
 * memory), not just anything sitting on a watchlist. Shared between the
 * Films and Séries pages via the `type` prop.
 */
export function RequestedNotAvailableSection({ type }: { type: "movie" | "tv" }) {
  const { data, isPending } = useQuery(
    orpc.discover.requestedNotAvailable.queryOptions({ input: { type } }),
  );
  const { t } = useLingui();
  if (isPending) return <TitleGridSectionSkeleton />;
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <FeedSection
      id={`requested-not-available-${type}`}
      title={t`Requested — Not Available`}
      icon={<IconDownload className="text-primary size-5" />}
      collapsible
      defaultOpen
      countLabel={`(${data?.totalResults ?? items.length})`}
    >
      <TitleGrid items={items} />
    </FeedSection>
  );
}
