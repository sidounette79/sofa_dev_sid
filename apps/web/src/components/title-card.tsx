import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  IconBookmarkFilled,
  IconCircleCheckFilled,
  IconDeviceTv,
  IconServer2,
  IconMinus,
  IconMovie,
  IconPlayerPlayFilled,
  IconPlus,
  IconStarFilled,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type MotionStyle, type MotionValue, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RequestDialog } from "@/components/titles/request-dialog";
import { useTiltEffect } from "@/hooks/use-tilt-effect";
import { orpc } from "@/lib/orpc/client";
import { thumbHashToUrl } from "@/lib/thumbhash";

export function TitleCardSkeleton() {
  return (
    <div className="bg-card overflow-hidden rounded-xl ring-1 ring-white/[0.06]">
      <Skeleton className="aspect-[2/3] w-full rounded-none" />
      <div className="px-3 pt-2.5 pb-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="mt-1.5 h-3 w-1/2" />
      </div>
    </div>
  );
}

type TitleStatus = "in_watchlist" | "watching" | "caught_up" | "completed" | "dropped";

interface TiltStyles {
  imageStyle: MotionStyle;
  glareBackground: MotionValue<string>;
  glareOpacity: MotionValue<number>;
}

interface CardInnerProps {
  title: string;
  type: string;
  posterPath: string | null;
  posterThumbHash?: string | null;
  releaseDate?: string | null;
  status?: string | null;
  voteAverage?: number | null;
  userStatus?: TitleStatus | null;
  embyStatus?: "available" | "removed" | null;
  requestedAt?: Date | string | null;
  watchCount?: number | null;
  episodeProgress?: { watched: number; total: number } | null;
  episodeLabel?: string | null;
  tiltStyles?: TiltStyles;
}

export interface TitleCardProps extends CardInnerProps {
  id: string;
}

// 25.08, Sid: simplified to one color per meaning, independent of the exact
// internal status — she doesn't care whether something's "in the process of
// being obtained" via a plain watchlist entry or a real Radarr/Sonarr
// request ("de base, c'est Sonarr qui doit faire le suivi"), only whether
// it's available yet. Real bug this surfaced (1923: owned/available but
// showing the watchlist bookmark instead of "ready to watch") — in_watchlist
// alone was never availability-aware, only ever the personal watch-progress
// status.
type EffectiveBadge = "obtaining" | "available" | "watchedAvailable" | "dropped";

export function getEffectiveBadge(
  userStatus: TitleStatus | null | undefined,
  embyStatus: "available" | "removed" | null | undefined,
  requestedAt?: Date | string | null,
): EffectiveBadge | null {
  // 25.08, Sid — real bug found live (logged in as Mary): a title already
  // available in Emby under someone else's library folder still showed "+"
  // and let her submit a duplicate request, because this only ever checked
  // embyStatus for a user who had *some* personal status (in_watchlist).
  // embyStatus itself is title-level (deriveEmbyStatus reads titles.
  // inEmbyLibrary/embyItemId, not anything per-user — see library.ts), so a
  // user with no personal status at all must still show "available"
  // (play/bookmark) rather than "+" whenever the household already has it.
  //
  // 26.08, Sid — same reasoning extended to requests: titles.requestedAt is
  // deliberately household-wide (see schema.ts's own doc comment), but this
  // still only ever showed the "obtaining" bookmark for whoever personally
  // had in_watchlist status. Confirmed live: XA's Discover page showed no
  // bookmark on titles Sid had already requested. A user with no personal
  // status at all must still show "obtaining" when someone in the house
  // already requested it, not fall through to "+".
  if (!userStatus) {
    if (embyStatus === "available") return "available";
    return requestedAt ? "obtaining" : null;
  }
  if (userStatus === "dropped") return "dropped";
  // 28.08, Sid — reverted the 26.08 red/green split: red on the watched dot
  // read as "trash" (same color as the dropped badge, right above it in this
  // same function) and duplicated the separate server-icon badge (embyStatus,
  // rendered per-card in CardInner) that already shows on-server/removed —
  // making that badge feel pointless. "Seen" is now a single green regardless
  // of embyStatus; on-disk status stays visible via the server icon alone.
  if (userStatus === "completed" || userStatus === "caught_up") {
    return "watchedAvailable";
  }
  if (userStatus === "watching") return "available";
  // in_watchlist: not started yet — the one case that genuinely depends on
  // whether it's physically available now.
  return embyStatus === "available" ? "available" : "obtaining";
}

export function useStatusConfig() {
  const { t } = useLingui();
  return {
    obtaining: {
      icon: IconBookmarkFilled,
      label: t`Obtaining`,
      colorClass: "bg-status-obtaining",
      badgeClass: "bg-status-obtaining/90 text-white",
    },
    available: {
      icon: IconPlayerPlayFilled,
      label: t`Ready to Watch`,
      colorClass: "bg-sky-500",
      badgeClass: "bg-sky-500/90 text-white",
    },
    watchedAvailable: {
      icon: IconCircleCheckFilled,
      // "Watched" collides with the (unrelated) followed-authors string
      // elsewhere, already translated as "Suivis" — a distinct source string
      // avoids stealing that translation for this badge.
      label: t`Seen`,
      colorClass: "bg-status-completed",
      badgeClass: "bg-status-completed/90 text-white",
    },
    dropped: {
      icon: IconTrash,
      label: t`Dropped`,
      colorClass: "bg-destructive",
      badgeClass: "bg-destructive/90 text-white",
    },
  } as const;
}

function EpisodeQuickActions({ id }: { id: string }) {
  const { t } = useLingui();
  const queryClient = useQueryClient();

  const watchNextMutation = useMutation(
    orpc.tracking.watchNext.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.list.key() });
      },
    }),
  );
  const unwatchLastMutation = useMutation(
    orpc.tracking.unwatchLast.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.library.list.key() });
      },
    }),
  );

  function handleNext(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (watchNextMutation.isPending) return;
    watchNextMutation.mutate(
      { id },
      {
        onSuccess: (result) => {
          if (result) toast.success(t`Watched S${result.seasonNumber} E${result.episodeNumber}`);
          else toast.info(t`No more episodes to watch`);
        },
      },
    );
  }

  function handlePrev(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (unwatchLastMutation.isPending) return;
    unwatchLastMutation.mutate(
      { id },
      {
        onSuccess: (result) => {
          if (result) toast.success(t`Unwatched S${result.seasonNumber} E${result.episodeNumber}`);
        },
      },
    );
  }

  return (
    <div className="absolute bottom-2 start-2 z-10 flex items-center gap-1 opacity-0 transition-opacity sm:group-hover:opacity-100">
      <button
        type="button"
        onClick={handlePrev}
        aria-label={t`Unwatch last episode`}
        className="flex size-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
      >
        <IconMinus className="size-3.5" />
      </button>
      <button
        type="button"
        onClick={handleNext}
        aria-label={t`Watch next episode`}
        className="flex size-7 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/80"
      >
        <IconPlus className="size-3.5" />
      </button>
    </div>
  );
}
function TitleContextMenuContent({
  id,
  type,
  userStatus,
}: {
  id: string;
  type: string;
  userStatus?: TitleStatus | null;
}) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const isDropped = userStatus === "dropped";

  function invalidateAfterStatusChange() {
    queryClient.invalidateQueries({ queryKey: orpc.library.list.key() });
    // Sid's ask (25.08): rejecting a recommendation should surface a
    // different one instead of leaving the dropped title sitting there
    // with its badge changed. getRecommendationsFeed already excludes
    // anything with a userTitleStatus row (dropped included) — this just
    // makes the section actually refetch instead of showing stale data.
    queryClient.invalidateQueries({ queryKey: orpc.discover.recommendations.key() });
    // Same for the per-title "Recommended" section (titles.similar) —
    // now filters dropped titles server-side too (apps/server/src/orpc/
    // procedures/titles.ts), this just triggers the refetch.
    queryClient.invalidateQueries({ queryKey: orpc.titles.similar.key() });
    // 06.09, Sid: dropping something from the Découvrir page (Trending/
    // Popular/Upcoming) left it sitting there until she left and came back —
    // these already filter dropped titles server-side (discover.ts), they
    // just were never invalidated here, so the stale page never refetched.
    queryClient.invalidateQueries({ queryKey: orpc.discover.trending.key() });
    queryClient.invalidateQueries({ queryKey: orpc.discover.popular.key() });
    queryClient.invalidateQueries({ queryKey: orpc.discover.upcomingMovies.key() });
    queryClient.invalidateQueries({ queryKey: orpc.discover.upcomingSeries.key() });
    // 08.10, Sid: dropping a tracked series left its still-airing episodes
    // sitting in "À venir" (library.upcoming — her own tracked-library
    // upcoming feed, distinct from discover.upcomingMovies/Series above)
    // until she left and came back. The server query already excludes
    // dropped titles (getUpcomingEpisodes/getUpcomingMovies, see their own
    // 28.08 comment) — this was just never invalidated here.
    queryClient.invalidateQueries({ queryKey: orpc.library.upcoming.key() });
    queryClient.invalidateQueries({ queryKey: orpc.library.continueWatching.key() });
  }

  // 06.09, Sid: "ça peut disparaître immédiatement" — invalidate+refetch
  // above still has a network round-trip before the list visually updates;
  // this removes the item from every currently-cached discover list right
  // away, no wait. Only for the drop direction (un-dropping something isn't
  // expected to instantly re-add it to a list it may have scrolled past).
  function removeFromDiscoverListsOptimistically() {
    queryClient.setQueriesData(
      {
        // oRPC's query keys are [["discover", "trending"], {input, type}] —
        // a plain prefix array won't partial-match the nested path array,
        // hence the predicate.
        predicate: (query) =>
          Array.isArray(query.queryKey[0]) && query.queryKey[0][0] === "discover",
      },
      (data: unknown) => {
        if (
          !data ||
          typeof data !== "object" ||
          !("items" in data) ||
          !Array.isArray((data as { items: unknown }).items)
        ) {
          return data;
        }
        return {
          ...data,
          items: (data as { items: { id: string }[] }).items.filter((item) => item.id !== id),
        };
      },
    );
  }

  const updateStatusMutation = useMutation(
    orpc.tracking.updateStatus.mutationOptions({
      onSuccess: invalidateAfterStatusChange,
    }),
  );
  // Sid's ask (25.08): after a fresh Emby scan, "À voir" was full of movies
  // she'd actually already seen — gaps in old TV-Time/Trakt imports never
  // marked them watched. A quick "Mark as Watched" right from the card lets
  // her clean that up without opening each title individually.
  const watchMutation = useMutation(
    orpc.tracking.watch.mutationOptions({
      onSuccess: invalidateAfterStatusChange,
    }),
  );

  function handleToggleDropped() {
    if (!isDropped) {
      // Fire-and-forget, ahead of the mutation resolving — see the comment
      // on removeFromDiscoverListsOptimistically. Un-dropping doesn't get
      // the same treatment: nothing to instantly re-add it to.
      removeFromDiscoverListsOptimistically();
    }
    updateStatusMutation.mutate(
      { id, status: isDropped ? "watchlist" : "dropped" },
      {
        onSuccess: () => {
          toast.success(isDropped ? t`Removed from dropped` : t`Marked as dropped`);
        },
      },
    );
  }

  function handleMarkWatched() {
    watchMutation.mutate(
      { scope: "movie", ids: [id] },
      {
        onSuccess: () => {
          toast.success(t`Marked as watched`);
        },
      },
    );
  }

  return (
    <ContextMenuContent>
      {type === "movie" && userStatus !== "completed" && (
        <ContextMenuItem onClick={handleMarkWatched}>
          <IconCircleCheckFilled className="size-3.5" />
          {t`Mark as Watched`}
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={handleToggleDropped} className="text-destructive">
        <IconTrash className="size-3.5" />
        {isDropped ? t`Remove Dropped Status` : t`Mark as Dropped`}
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
function QuickAddButton({
  id,
  type,
  userStatus,
  embyStatus,
  requestedAt,
  watchCount,
}: {
  id: string;
  type: string;
  userStatus?: TitleStatus | null;
  embyStatus?: "available" | "removed" | null;
  requestedAt?: Date | string | null;
  watchCount?: number | null;
}) {
  const { t } = useLingui();
  const statusConfig = useStatusConfig();
  // Sid's ask (25.08): the quick "+" everywhere she discovers something new
  // (trending, hero banner, etc.) used to silently add to the passive
  // Watchlist — she almost never uses that, her real workflow is "found it,
  // download it now". Opens the same Request dialog as the title page's
  // "Request" button instead (season picker skipped here — pass no season
  // data, RequestDialog already treats that as "request every season").
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);

  const effectiveBadge = getEffectiveBadge(userStatus, embyStatus, requestedAt);
  const isAdded = effectiveBadge != null;
  const config = effectiveBadge ? statusConfig[effectiveBadge] : null;

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isAdded) return;
    setRequestDialogOpen(true);
  }

  if (isAdded && config) {
    const StatusIcon = config.icon;
    const showRewatchCount = effectiveBadge === "watchedAvailable" && (watchCount ?? 0) > 1;
    return (
      <Tooltip>
        <TooltipTrigger
          className={`absolute end-2 top-2 z-10 flex size-6 cursor-default items-center justify-center rounded-full backdrop-blur-sm ${config.badgeClass}`}
          render={<div />}
        >
          <StatusIcon className="size-3.5" />
          {showRewatchCount && (
            <span className="bg-background text-foreground ring-border absolute -end-1 -bottom-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full px-0.5 text-[9px] leading-none font-semibold ring-1">
              +{(watchCount ?? 1) - 1}
            </span>
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom">{config.label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          onClick={handleClick}
          className="absolute end-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/50 text-white opacity-60 backdrop-blur-sm transition-opacity hover:bg-black/70 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          render={<button type="button" />}
        >
          <IconPlus className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="bottom">{t`Request`}</TooltipContent>
      </Tooltip>
      <RequestDialog
        open={requestDialogOpen}
        onOpenChange={setRequestDialogOpen}
        titleId={id}
        titleType={type === "movie" ? "movie" : "tv"}
        seasons={[]}
      />
    </>
  );
}

function ProgressBar({ watched, total }: { watched: number; total: number }) {
  const { t } = useLingui();
  const pct = total > 0 ? (watched / total) * 100 : 0;
  return (
    <Tooltip>
      <TooltipTrigger
        className="absolute right-0 bottom-0 left-0 z-10 h-1 cursor-default bg-white/10"
        render={<div />}
      >
        <div
          className="bg-status-obtaining h-full transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </TooltipTrigger>
      <TooltipContent side="top">
        {t`${watched}/${plural(total, { one: "# episode", other: "# episodes" })}`}
      </TooltipContent>
    </Tooltip>
  );
}

function CardInner({
  title,
  type,
  posterPath,
  posterThumbHash,
  releaseDate,
  voteAverage,
  userStatus,
  embyStatus,
  requestedAt,
  watchCount,
  episodeProgress,
  episodeLabel,
  tiltStyles,
}: CardInnerProps) {
  const { t } = useLingui();
  const statusConfig = useStatusConfig();
  const effectiveBadge = getEffectiveBadge(userStatus, embyStatus, requestedAt);
  const year = releaseDate?.slice(0, 4);
  const TypeIcon = type === "movie" ? IconMovie : IconDeviceTv;
  const placeholderUrl = thumbHashToUrl(posterThumbHash);

  const ringClass = userStatus ? "ring-primary/25 shadow-sm shadow-primary/5" : "ring-white/[0.06]";
  // Rewatched at least once — tint the status dot instead of the usual
  // per-status color, same accent as the episode checkboxes on the title
  // page, so a second (or third...) watch-through is visible at a glance.
  const isRewatched = (watchCount ?? 0) > 1 && userStatus !== "dropped";
  const statusDotClass = isRewatched
    ? "bg-status-ended"
    : effectiveBadge
      ? statusConfig[effectiveBadge].colorClass
      : "bg-status-obtaining";

  return (
    <div
      className={`bg-card hover:shadow-primary/5 hover:ring-primary/25 relative overflow-hidden rounded-xl ring-1 transition-[box-shadow,ring-color] duration-200 ease-out hover:shadow-lg ${ringClass}`}
    >
      <div
        className="bg-card aspect-[2/3] overflow-hidden"
        style={
          placeholderUrl
            ? {
                backgroundImage: `url(${placeholderUrl})`,
                backgroundSize: "cover",
              }
            : undefined
        }
      >
        {posterPath ? (
          <motion.div style={tiltStyles?.imageStyle}>
            <img
              src={posterPath}
              alt={title}
              width={300}
              height={450}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          </motion.div>
        ) : (
          <div className="from-card via-secondary to-muted relative flex h-full items-center justify-center overflow-hidden bg-gradient-to-br">
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.06]"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
              }}
            />
            <div className="from-primary/10 absolute inset-0 bg-gradient-to-t via-transparent to-transparent" />
            <div className="relative px-3 text-center">
              <p className="font-display text-foreground/70 text-sm leading-snug tracking-tight">
                {title}
              </p>
            </div>
          </div>
        )}
        {embyStatus && (
          <Tooltip>
            <TooltipTrigger
              className={`absolute top-2 start-2 z-10 flex size-6 cursor-default items-center justify-center rounded-full text-white backdrop-blur-sm ${embyStatus === "available" ? "bg-status-completed/90" : "bg-destructive/90"}`}
              render={<div />}
            >
              <IconServer2 className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {embyStatus === "available" ? t`Available on your server` : t`No longer on your server`}
            </TooltipContent>
          </Tooltip>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
        {tiltStyles && (
          <motion.div
            className="pointer-events-none absolute inset-0 z-[5] rounded-xl"
            style={{
              background: tiltStyles.glareBackground,
              opacity: tiltStyles.glareOpacity,
            }}
          />
        )}
      </div>

      <div className="px-3 pt-2.5 pb-3">
        <div className="flex items-center gap-1.5">
          {userStatus && effectiveBadge && (
            <Tooltip>
              <TooltipTrigger
                className="shrink-0 cursor-default"
                render={<div className="flex items-center" />}
              >
                <span className="relative flex size-2">
                  <span
                    className={`absolute inline-flex h-full w-full rounded-full opacity-40 ${statusDotClass}`}
                  />
                  <span className={`relative inline-flex size-2 rounded-full ${statusDotClass}`} />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {isRewatched
                  ? t`${statusConfig[effectiveBadge].label} — watched again`
                  : statusConfig[effectiveBadge].label}
              </TooltipContent>
            </Tooltip>
          )}
          <p className="line-clamp-1 text-sm leading-snug font-medium">{title}</p>
        </div>
        <div className="text-muted-foreground mt-1.5 flex items-center gap-2 text-xs">
          <TypeIcon aria-hidden={true} className="text-primary/60 size-3.5 shrink-0" />
          {year && <span>{year}</span>}
          {voteAverage != null && voteAverage > 0 && (
            <span className="text-primary/80 ml-auto flex items-center gap-0.5">
              <IconStarFilled aria-hidden={true} className="size-[11px]" />
              {voteAverage.toFixed(1)}
            </span>
          )}
        </div>
        {episodeProgress && episodeProgress.total > 0 && (
          <p className="text-muted-foreground mt-1 flex items-center gap-1 overflow-hidden text-xs whitespace-nowrap">
            {episodeLabel && (
              <span className="text-foreground/80 shrink-0 truncate font-mono">{episodeLabel}</span>
            )}
            {episodeLabel && <span aria-hidden="true">·</span>}
            <span className="shrink-0">
              {episodeProgress.watched}/{episodeProgress.total}
            </span>
          </p>
        )}
      </div>

      {episodeProgress && episodeProgress.watched > 0 && (
        <ProgressBar watched={episodeProgress.watched} total={episodeProgress.total} />
      )}
    </div>
  );
}

export function TitleCard({
  id,
  type,
  title,
  posterPath,
  posterThumbHash,
  releaseDate,
  status,
  voteAverage,
  userStatus,
  embyStatus,
  requestedAt,
  watchCount,
  episodeProgress,
  episodeLabel,
}: TitleCardProps) {
  const {
    ref: tiltRef,
    containerStyle,
    imageStyle,
    glareBackground,
    glareOpacity,
    handlers,
  } = useTiltEffect();

  const cardContent = (
    <motion.div ref={tiltRef} style={containerStyle} {...handlers}>
      <CardInner
        title={title}
        type={type}
        posterPath={posterPath}
        posterThumbHash={posterThumbHash}
        releaseDate={releaseDate}
        status={status}
        voteAverage={voteAverage}
        userStatus={userStatus}
        embyStatus={embyStatus}
        requestedAt={requestedAt}
        watchCount={watchCount}
        episodeProgress={episodeProgress}
        episodeLabel={episodeLabel}
        tiltStyles={{
          imageStyle,
          glareBackground,
          glareOpacity,
        }}
      />
    </motion.div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger render={<div className="group relative" />}>
        <QuickAddButton
          id={id}
          type={type}
          userStatus={userStatus}
          embyStatus={embyStatus}
          requestedAt={requestedAt}
          watchCount={watchCount}
        />
        {type === "tv" && userStatus !== "dropped" && <EpisodeQuickActions id={id} />}
        <Link to="/titles/$id" params={{ id }}>
          {cardContent}
        </Link>
      </ContextMenuTrigger>
      <TitleContextMenuContent id={id} type={type} userStatus={userStatus} />
    </ContextMenu>
  );
}
