import { useLingui } from "@lingui/react/macro";
import { IconDeviceTv } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { orpc } from "@/lib/orpc/client";
import { FeedSection } from "./feed-section";

export function NowPlayingSection({
  compact = false,
  narrow = false,
}: { compact?: boolean; narrow?: boolean } = {}) {
  const { data } = useQuery({
    ...orpc.library.nowPlaying.queryOptions(),
    refetchInterval: 7000,
  });
  const { t } = useLingui();
  const items = data?.items ?? [];
  if (items.length === 0) return null;

  return (
    <FeedSection
      id="now-playing"
      collapsible
      defaultOpen
      title={t`Now Playing`}
      icon={<IconDeviceTv className="text-primary size-5" />}
    >
      {/* 18.11 : `narrow` sert quand la section tient dans une colonne
          etroite a cote des listes « derniers vus » (series-overview). Une
          grille a 4 colonnes dans 30 % de la largeur d'un telephone donne
          des vignettes de 30 px: on repasse a une seule colonne. */}
      <div
        className={
          narrow
            ? "grid grid-cols-1 gap-3 lg:grid-cols-2"
            : compact
              ? "grid grid-cols-4 gap-3 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10"
              : "grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
        }
      >
        {items.map((item) => (
          <div key={item.sessionId} className="space-y-2">
            <div className="bg-muted relative aspect-2/3 overflow-hidden rounded-lg">
              {item.posterPath && (
                <img
                  src={item.posterPath}
                  alt={item.title}
                  className="h-full w-full object-cover"
                />
              )}
              <div className="bg-background/80 absolute right-2 bottom-2 left-2 h-1.5 overflow-hidden rounded-full">
                <div
                  className="bg-primary h-full transition-all"
                  style={{ width: `${item.progressPercent}%` }}
                />
              </div>
            </div>
            <div className={narrow ? "text-[11px] leading-tight" : "text-sm"}>
              <p className="truncate font-medium">{item.title}</p>
              {item.type === "tv" && (
                <p
                  className={
                    narrow
                      ? "text-muted-foreground truncate text-[10px]"
                      : "text-muted-foreground truncate text-xs"
                  }
                >
                  S{item.seasonNumber}E{item.episodeNumber}
                  {!narrow && ` — ${item.episodeName}`}
                </p>
              )}
              {item.userName && !narrow && (
                <p className="text-muted-foreground truncate text-xs">{item.userName}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </FeedSection>
  );
}
