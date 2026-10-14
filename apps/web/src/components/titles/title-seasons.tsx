import { Trans, useLingui } from "@lingui/react/macro";
import {
  IconCheck,
  IconChecks,
  IconChevronDown,
  IconChevronUp,
  IconDeviceTv,
  IconDeviceTvOld,
  IconSortAscending,
  IconSortDescending,
} from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import type { Season } from "@sofa/api/schemas";
import { formatShortDate } from "@sofa/i18n/format";

import { PlayOnDialog } from "./play-on-dialog";
import { useTitleContext, useTitleUserInfo } from "./title-context";
import { useTitleActions } from "./use-title-actions";

// 26.08, Sid — real bug found live: TMDB's season "name" field is
// frequently just "Season 1"/"Season 2" in English even when the rest of
// the title's metadata is correctly localized to French — TMDB doesn't
// always translate season names. Trusting it blindly left English text
// stranded in an otherwise-French page. request-dialog.tsx already
// translates its own fallback (never hits this since it only uses the
// fallback when name is absent) — this detects the generic English name
// TMDB itself sent and swaps it for the translated fallback too.
const GENERIC_ENGLISH_SEASON_NAME = /^season\s+\d+$/i;
function isGenericEnglishSeasonName(
  name: string | null | undefined,
  seasonNumber: number,
): boolean {
  if (!name) return true;
  return GENERIC_ENGLISH_SEASON_NAME.test(name) && name.trim() === `Season ${seasonNumber}`;
}

export function SeasonsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="size-5 rounded" />
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="space-y-2">
        {["s1", "s2", "s3"].map((id) => (
          <div key={id} className="border-border/50 bg-card/50 overflow-hidden rounded-xl border">
            <div className="flex items-center justify-between p-4">
              <Skeleton className="h-4 w-24" />
              <div className="flex items-center gap-3">
                <Skeleton className="hidden h-2 w-24 rounded-full sm:block" />
                <Skeleton className="h-3 w-10" />
                <Skeleton className="size-4" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TitleSeasons({
  seasons: streamedSeasons,
}: {
  seasons?: Season[];
} = {}) {
  const { t } = useLingui();
  const { seasons, setSeasons, watchingEp } = useTitleContext();
  const { episodeWatches, rewatchedEpisodeIds, userStatus } = useTitleUserInfo();

  // When seasons are streamed via Suspense, sync them into context
  useEffect(() => {
    if (streamedSeasons && streamedSeasons.length > 0) {
      setSeasons(streamedSeasons);
    }
  }, [streamedSeasons, setSeasons]);

  const watchedSet = useMemo(() => new Set(episodeWatches), [episodeWatches]);
  const rewatchedSet = useMemo(() => new Set(rewatchedEpisodeIds), [rewatchedEpisodeIds]);
  const { handleWatchEpisode, handleMarkSeason, handleUnmarkSeason, handleMarkAllWatched } =
    useTitleActions();
  const seasonProgress = useMemo(() => {
    const map = new Map<string, number>();
    for (const season of seasons) {
      let count = 0;
      for (const ep of season.episodes) {
        if (watchedSet.has(ep.id)) count++;
      }
      map.set(season.id, count);
    }
    return map;
  }, [seasons, watchedSet]);

  const [openSeason, setOpenSeason] = useState<number | null>(null);
  const [expandedEpisodes, setExpandedEpisodes] = useState<Set<string>>(new Set());
  const toggleEpisodeExpanded = (episodeId: string) => {
    setExpandedEpisodes((prev) => {
      const next = new Set(prev);
      if (next.has(episodeId)) next.delete(episodeId);
      else next.add(episodeId);
      return next;
    });
  };
  const [markAllOpen, setMarkAllOpen] = useState(false);
  // 01.09, Sid — "Lire sur..." per episode: a single dialog instance
  // (rather than one per episode row) keyed to whichever episode's button
  // was last clicked.
  const [playOnEpisodeId, setPlayOnEpisodeId] = useState<string | null>(null);
  const [seasonOrder, setSeasonOrder] = useState<"asc" | "desc">("asc");
  const orderedSeasons = useMemo(
    () => (seasonOrder === "asc" ? seasons : [...seasons].reverse()),
    [seasons, seasonOrder],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <IconDeviceTvOld aria-hidden={true} className="text-primary size-5" />
          <h2 className="font-display text-2xl tracking-tight">
            <Trans>Episodes</Trans>
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setSeasonOrder(seasonOrder === "asc" ? "desc" : "asc")}
            aria-label={seasonOrder === "asc" ? t`First season first` : t`Last season first`}
            className="text-muted-foreground"
          >
            {seasonOrder === "asc" ? (
              <IconSortAscending aria-hidden={true} className="size-3.5" />
            ) : (
              <IconSortDescending aria-hidden={true} className="size-3.5" />
            )}
          </Button>
        {userStatus !== "completed" && (
          <AlertDialog open={markAllOpen} onOpenChange={setMarkAllOpen}>
            <AlertDialogTrigger
              render={
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground tracking-wider uppercase"
                >
                  <IconChecks aria-hidden={true} className="size-3.5" />
                  <Trans>Mark All Watched</Trans>
                </Button>
              }
            />
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  <Trans>Mark all episodes as watched?</Trans>
                </AlertDialogTitle>
                <AlertDialogDescription>
                  <Trans>
                    This will mark every episode of this show as watched. You can undo this later by
                    unmarking individual seasons.
                  </Trans>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>
                  <Trans>Cancel</Trans>
                </AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    handleMarkAllWatched();
                    setMarkAllOpen(false);
                  }}
                >
                  <Trans>Mark All Watched</Trans>
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        </div>
      </div>
      <div className="space-y-2">
        {orderedSeasons.map((season) => {
          const isOpen = openSeason === season.seasonNumber;
          const watchedCount = seasonProgress.get(season.id) ?? 0;
          const totalCount = season.episodes.length;
          const progressPercent = totalCount > 0 ? (watchedCount / totalCount) * 100 : 0;

          return (
            <div
              key={season.id}
              className="border-border/50 bg-card/50 overflow-hidden rounded-xl border"
            >
              <button
                type="button"
                onClick={() => setOpenSeason(isOpen ? null : season.seasonNumber)}
                className="group/season hover:bg-accent/50 flex w-full cursor-pointer items-center justify-between p-4 text-start transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="font-medium">
                    {isGenericEnglishSeasonName(season.name, season.seasonNumber)
                      ? t`Season ${season.seasonNumber}`
                      : season.name}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {/* Real bug found live (24.08, Sid): the per-season "Watch
                      all" button used to only appear on :hover of the season
                      row on desktop — invisible/undiscoverable in practice,
                      she only ever saw the whole-series button. Always show
                      the progress bar and the action button side by side
                      instead of swapping one for the other on hover. */}
                  {totalCount > 0 && (
                    <div className="hidden w-16 sm:block">
                      <Progress value={progressPercent} />
                    </div>
                  )}
                  {totalCount > 0 && watchedCount < totalCount && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleMarkSeason(season);
                      }}
                      className="text-primary hover:bg-primary/10 hover:text-primary tracking-wider uppercase"
                    >
                      <IconChecks aria-hidden={true} className="size-3.5 sm:hidden" />
                      <span className="hidden sm:inline">
                        <Trans>Watch all</Trans>
                      </span>
                    </Button>
                  )}
                  {totalCount > 0 && watchedCount === totalCount && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleUnmarkSeason(season);
                      }}
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive tracking-wider uppercase"
                    >
                      <IconChecks aria-hidden={true} className="size-3.5 sm:hidden" />
                      <span className="hidden sm:inline">
                        <Trans>Unwatch all</Trans>
                      </span>
                    </Button>
                  )}
                  {totalCount > 0 && (
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                      {watchedCount}/{totalCount}
                    </span>
                  )}
                  {isOpen ? (
                    <IconChevronUp aria-hidden={true} className="text-muted-foreground size-4" />
                  ) : (
                    <IconChevronDown aria-hidden={true} className="text-muted-foreground size-4" />
                  )}
                </div>
              </button>

              <AnimatePresence>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{
                      type: "spring",
                      stiffness: 300,
                      damping: 30,
                    }}
                    className="border-border/50 overflow-hidden border-t"
                  >
                    {season.episodes.map((ep) => {
                      const isWatched = watchedSet.has(ep.id);
                      const isRewatched = rewatchedSet.has(ep.id);
                      const { stillPath } = ep;
                      const epNum = ep.episodeNumber;
                      const isExpanded = expandedEpisodes.has(ep.id);
                      return (
                        <div
                          key={ep.id}
                          className={`border-border/30 border-b transition-colors last:border-b-0 ${isWatched ? "opacity-60" : ""}`}
                        >
                          {/* Mobile: still banner above episode info */}
                          {stillPath && (
                            <div className="bg-muted relative aspect-video w-full overflow-hidden sm:hidden">
                              <img
                                src={stillPath}
                                alt={ep.name ?? ""}
                                width={600}
                                height={338}
                                loading="lazy"
                                decoding="async"
                                className="h-full w-full object-cover"
                              />
                              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
                              <span className="absolute start-3 bottom-2 font-mono text-[10px] text-white/70">
                                E{String(ep.episodeNumber).padStart(2, "0")}
                              </span>
                            </div>
                          )}
                          <div className="flex gap-3 px-4 py-3">
                            <button
                              type="button"
                              aria-label={
                                isWatched
                                  ? t`Unmark episode ${epNum}`
                                  : t`Mark episode ${epNum} watched`
                              }
                              onClick={() =>
                                handleWatchEpisode(
                                  ep.id,
                                  season.seasonNumber,
                                  ep.episodeNumber,
                                  isWatched,
                                )
                              }
                              disabled={watchingEp === ep.id}
                              className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-all ${
                                isWatched
                                  ? isRewatched
                                    ? "border-status-ended bg-status-ended text-primary-foreground"
                                    : "border-primary bg-primary text-primary-foreground"
                                  : "border-muted-foreground/40 bg-muted-foreground/5 hover:border-primary/70 hover:bg-primary/10"
                              }`}
                              title={isRewatched ? t`Watched more than once` : undefined}
                            >
                              {isWatched && (
                                <motion.div
                                  initial={{ scale: 0 }}
                                  animate={{ scale: 1 }}
                                  transition={{
                                    type: "spring",
                                    stiffness: 500,
                                    damping: 15,
                                  }}
                                >
                                  <IconCheck className="size-3.5" />
                                </motion.div>
                              )}
                            </button>
                            {/* Desktop: inline thumbnail */}
                            {stillPath && (
                              <div className="bg-muted hidden h-14 w-24 shrink-0 overflow-hidden rounded-md sm:block">
                                <img
                                  src={stillPath}
                                  alt={ep.name ?? ""}
                                  width={300}
                                  height={169}
                                  loading="lazy"
                                  decoding="async"
                                  className="h-full w-full object-cover"
                                />
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => ep.overview && toggleEpisodeExpanded(ep.id)}
                              className={`min-w-0 flex-1 text-start ${ep.overview ? "cursor-pointer" : "cursor-default"}`}
                            >
                              <p className="text-sm">
                                {/* Episode number shown inline on desktop, or mobile without still */}
                                <span
                                  className={`text-muted-foreground font-mono text-xs ${stillPath ? "hidden sm:inline" : ""}`}
                                >
                                  E{String(ep.episodeNumber).padStart(2, "0")}
                                </span>
                                <span className="hidden sm:inline"> </span>
                                <span className="font-medium">
                                  {ep.name ?? <Trans>Untitled</Trans>}
                                </span>
                              </p>
                              <p className="text-muted-foreground text-xs">
                                {ep.airDate ? formatShortDate(ep.airDate) : ""}
                                {ep.airDate && ep.runtimeMinutes ? " · " : ""}
                                {ep.runtimeMinutes ? `${ep.runtimeMinutes}m` : ""}
                              </p>
                              {ep.overview && (
                                <p
                                  className={`text-muted-foreground/70 mt-1 text-xs leading-relaxed ${isExpanded ? "" : "line-clamp-2"}`}
                                >
                                  {ep.overview}
                                </p>
                              )}
                            </button>
                            <button
                              type="button"
                              aria-label={t`Play episode ${epNum} on...`}
                              onClick={() => setPlayOnEpisodeId(ep.id)}
                              className="text-muted-foreground hover:text-primary mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors"
                            >
                              <IconDeviceTv className="size-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
      {playOnEpisodeId && (
        <PlayOnDialog
          open={playOnEpisodeId !== null}
          onOpenChange={(open) => !open && setPlayOnEpisodeId(null)}
          target={{ episodeId: playOnEpisodeId }}
        />
      )}
    </div>
  );
}
