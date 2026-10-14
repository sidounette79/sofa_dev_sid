import { useLingui } from "@lingui/react/macro";
import { IconCircleCheck } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc/client";
import { FeedSection } from "./feed-section";
import { TitleGrid, TitleGridSectionSkeleton } from "./title-grid";

/**
 * "Déjà vus" for Films (24.08, Sid, reworked 26.08, dot color reverted
 * 28.08). Originally split into two separate lists (still on Emby / no
 * longer there); merged into one once the card itself could show the
 * distinction. That's now the server-icon badge in the corner of each
 * TitleCard (embyStatus), not the watched dot (green regardless of
 * embyStatus, see title-card.tsx) — the merge still holds either way.
 * Header count uses library.list's real totalResults instead of this
 * section's own fetch cap (real bug found live: with limit:40, the
 * "22"/"18" split shown here was a sample of her 40 most-recently-updated
 * watched movies, not her true ~1900).
 */
export function WatchedMoviesSection() {
  const { data, isPending } = useQuery(
    orpc.library.list.queryOptions({
      input: { page: 1, limit: 40, statuses: ["completed"], type: "movie" },
    }),
  );
  const { t } = useLingui();
  if (isPending) return <TitleGridSectionSkeleton />;
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <FeedSection
      id="watched-movies"
      // Reuses the badge's own "Seen" string (not "Watched" — that msgid
      // already collides with the unrelated followed-authors label, see the
      // matching comment in title-card.tsx's getEffectiveBadge).
      title={t`Seen`}
      countLabel={`(${data?.totalResults ?? items.length})`}
      icon={<IconCircleCheck className="text-primary size-5" />}
      seeAllLink="/library"
      seeAllSearch={{ type: "movie", statuses: ["completed"] }}
      collapsible
      defaultOpen={false}
    >
      <TitleGrid items={items} />
    </FeedSection>
  );
}
