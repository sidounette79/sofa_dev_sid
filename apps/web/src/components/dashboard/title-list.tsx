import { IconMovie, IconStarFilled } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { getEffectiveBadge, useStatusConfig } from "@/components/title-card";
import { thumbHashToUrl } from "@/lib/thumbhash";

interface TitleListItem {
  id: string;
  type: string;
  title: string;
  posterPath: string | null;
  posterThumbHash?: string | null;
  releaseDate?: string | null;
  firstAirDate?: string | null;
  voteAverage?: number | null;
  userStatus?: "in_watchlist" | "watching" | "caught_up" | "completed" | "dropped" | null;
  embyStatus?: "available" | "removed" | null;
  requestedAt?: Date | string | null;
  episodeProgress?: { watched: number; total: number } | null;
}

// 26.08, Sid — full badge audit: this list view had its own separate,
// out-of-sync copy of the status dot logic (old "On Watchlist" wording,
// never updated when the card view moved to the availability+watched
// badge system, no embyStatus/requestedAt awareness at all). Reuses the
// exact same getEffectiveBadge/useStatusConfig the grid cards use instead
// of maintaining a second copy that drifts.
function TitleListRow({ item }: { item: TitleListItem }) {
  const statusConfig = useStatusConfig();
  const year = (item.releaseDate ?? item.firstAirDate)?.slice(0, 4);
  const effectiveBadge = getEffectiveBadge(item.userStatus, item.embyStatus, item.requestedAt);
  const badge = effectiveBadge ? statusConfig[effectiveBadge] : null;

  return (
    <Link
      to="/titles/$id"
      params={{ id: item.id }}
      className="group bg-card/40 hover:bg-card/60 hover:shadow-primary/5 hover:ring-primary/25 flex items-center gap-3 rounded-xl px-3 py-2.5 ring-1 ring-white/[0.06] transition-[background,box-shadow,ring-color] duration-200 hover:shadow-lg"
    >
      <div className="relative h-[66px] w-11 shrink-0 overflow-hidden rounded-lg ring-1 ring-white/[0.06]">
        {item.posterPath ? (
          <img
            src={item.posterPath}
            alt=""
            className="size-full object-cover motion-safe:transition-transform motion-safe:duration-300 motion-safe:group-hover:scale-105"
            loading="lazy"
            {...(item.posterThumbHash
              ? {
                  style: {
                    background: `url(${thumbHashToUrl(item.posterThumbHash)}) center/cover`,
                  },
                }
              : {})}
          />
        ) : (
          <div className="bg-muted flex size-full items-center justify-center">
            <IconMovie className="text-muted-foreground size-5" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {badge && (
            <span
              className={`inline-flex size-2 shrink-0 rounded-full ${badge.colorClass}`}
              title={badge.label}
            />
          )}
          <span className="truncate text-sm font-medium">{item.title}</span>
        </div>
        <div className="text-muted-foreground mt-0.5 flex items-center gap-2 text-xs">
          {year && <span>{year}</span>}
          {item.episodeProgress && (
            <span>
              {item.episodeProgress.watched}/{item.episodeProgress.total}
            </span>
          )}
        </div>
      </div>

      {item.voteAverage != null && item.voteAverage > 0 && (
        <div className="text-muted-foreground flex shrink-0 items-center gap-1 text-xs">
          <IconStarFilled className="size-3 text-amber-400" />
          {item.voteAverage.toFixed(1)}
        </div>
      )}
    </Link>
  );
}

export function TitleList({ items }: { items: TitleListItem[] }) {
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <TitleListRow key={item.id} item={item} />
      ))}
    </div>
  );
}
