import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { toast } from "sonner";

import { orpc } from "@/lib/orpc/client";
import type { Season } from "@sofa/api/schemas";

import { useTitleContext } from "./title-context";

type UserInfo = {
  status: "in_watchlist" | "watching" | "caught_up" | "completed" | "dropped" | null;
  rating: number | null;
  episodeWatches: string[];
  rewatchedEpisodeIds: string[];
};

const EMPTY_USER_INFO: UserInfo = {
  status: null,
  rating: null,
  episodeWatches: [],
  rewatchedEpisodeIds: [],
};

export function useTitleActions() {
  const { t } = useLingui();
  const { titleId, titleName, seasons, setWatchingEp } = useTitleContext();
  const queryClient = useQueryClient();
  const userInfoKey = orpc.tracking.userInfo.queryKey({ input: { id: titleId } });

  const getUserInfo = useCallback(
    () => queryClient.getQueryData<UserInfo>(userInfoKey) ?? EMPTY_USER_INFO,
    [queryClient, userInfoKey],
  );

  const setUserInfo = useCallback(
    (updater: (old: UserInfo) => UserInfo) => {
      queryClient.setQueryData<UserInfo>(userInfoKey, (old) => updater(old ?? EMPTY_USER_INFO));
    },
    [queryClient, userInfoKey],
  );

  const { mutateAsync: watch } = useMutation(orpc.tracking.watch.mutationOptions());
  const { mutateAsync: unwatch } = useMutation(orpc.tracking.unwatch.mutationOptions());
  const { mutateAsync: updateStatus } = useMutation(orpc.tracking.updateStatus.mutationOptions());
  const { mutateAsync: updateRating } = useMutation(orpc.tracking.rate.mutationOptions());
  const { mutateAsync: rewatch } = useMutation(orpc.tracking.rewatch.mutationOptions());

  const catchUp = useCallback(
    async (episodeIds: string[]) => {
      await queryClient.cancelQueries({ queryKey: userInfoKey });
      const prev = getUserInfo();
      const newWatchSet = new Set(prev.episodeWatches);
      for (const id of episodeIds) newWatchSet.add(id);
      const newWatches = [...newWatchSet];

      setUserInfo((old) => ({
        ...old,
        episodeWatches: newWatches,
      }));

      try {
        await watch({ scope: "episode", ids: episodeIds });
        await queryClient.invalidateQueries({ queryKey: userInfoKey });
        const count = episodeIds.length;
        toast.success(
          t`Caught up — marked ${plural(count, { one: "# episode", other: "# episodes" })} as watched`,
        );
      } catch {
        setUserInfo((old) => ({
          ...old,
          episodeWatches: prev.episodeWatches,
          status: prev.status,
        }));
        toast.error(t`Failed to catch up`);
      }
    },
    [getUserInfo, setUserInfo, watch, queryClient, userInfoKey, t],
  );

  const handleStatusChange = useCallback(
    async (status: "watchlist" | "dropped" | null) => {
      await queryClient.cancelQueries({ queryKey: userInfoKey });
      const prevStatus = getUserInfo().status;
      const optimisticStatus =
        status === "watchlist" ? "in_watchlist" : status === "dropped" ? "dropped" : null;
      setUserInfo((old) => ({
        ...old,
        status: optimisticStatus,
      }));
      try {
        await updateStatus({
          id: titleId,
          status,
        });
        toast.success(
          status === "watchlist"
            ? t`Added to watchlist`
            : status === "dropped"
              ? t`Marked as dropped`
              : t`Removed from library`,
        );
        // 08.10, Sid: marking a title dropped from its own detail page only
        // ever refreshed this title's own userInfo — every other cached
        // list (library grid, "À venir", recommendations, discover feeds)
        // kept showing it until a manual reload. Same invalidation set as
        // the grid-card dropdown's own invalidateAfterStatusChange
        // (title-card.tsx) — both are ways to change a title's status, both
        // need to ripple the same way.
        queryClient.invalidateQueries({ queryKey: orpc.library.list.key() });
        queryClient.invalidateQueries({ queryKey: orpc.library.upcoming.key() });
        queryClient.invalidateQueries({ queryKey: orpc.library.continueWatching.key() });
        queryClient.invalidateQueries({ queryKey: orpc.discover.recommendations.key() });
        queryClient.invalidateQueries({ queryKey: orpc.titles.similar.key() });
        queryClient.invalidateQueries({ queryKey: orpc.discover.trending.key() });
        queryClient.invalidateQueries({ queryKey: orpc.discover.popular.key() });
        queryClient.invalidateQueries({ queryKey: orpc.discover.upcomingMovies.key() });
        queryClient.invalidateQueries({ queryKey: orpc.discover.upcomingSeries.key() });
      } catch {
        setUserInfo((old) => ({ ...old, status: prevStatus }));
        toast.error(t`Failed to update status`);
      }
    },
    [getUserInfo, setUserInfo, queryClient, userInfoKey, titleId, updateStatus, t],
  );

  const handleRating = useCallback(
    async (ratingStars: number) => {
      await queryClient.cancelQueries({ queryKey: userInfoKey });
      const prevRating = getUserInfo().rating;
      setUserInfo((old) => ({ ...old, rating: ratingStars }));
      try {
        await updateRating({
          id: titleId,
          stars: ratingStars,
        });
        toast.success(
          ratingStars > 0
            ? t`Rated ${plural(ratingStars, { one: "# star", other: "# stars" })}`
            : t`Rating removed`,
        );
      } catch {
        setUserInfo((old) => ({ ...old, rating: prevRating }));
        toast.error(t`Failed to update rating`);
      }
    },
    [getUserInfo, setUserInfo, queryClient, userInfoKey, titleId, updateRating, t],
  );

  const handleWatchMovie = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: userInfoKey });
    const prevStatus = getUserInfo().status;
    setUserInfo((old) => ({ ...old, status: "completed" }));
    try {
      await watch({ scope: "movie", ids: [titleId] });
      toast.success(t`Marked "${titleName}" as watched`);
    } catch {
      setUserInfo((old) => ({ ...old, status: prevStatus }));
      toast.error(t`Failed to mark as watched`);
    }
  }, [getUserInfo, setUserInfo, queryClient, userInfoKey, titleId, titleName, watch, t]);

  const handleUnwatchMovie = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: userInfoKey });
    const prevStatus = getUserInfo().status;
    setUserInfo((old) => ({ ...old, status: "in_watchlist" }));
    try {
      await unwatch({ scope: "movie", ids: [titleId] });
      toast.success(t`Marked "${titleName}" as unwatched`);
    } catch {
      setUserInfo((old) => ({ ...old, status: prevStatus }));
      toast.error(t`Failed to mark as unwatched`);
    }
  }, [getUserInfo, setUserInfo, queryClient, userInfoKey, titleId, titleName, unwatch, t]);

  const handleWatchEpisode = useCallback(
    async (episodeId: string, seasonNum: number, epNum: number, isWatched: boolean) => {
      await queryClient.cancelQueries({ queryKey: userInfoKey });
      setWatchingEp(episodeId);

      if (isWatched) {
        const prevWatches = getUserInfo().episodeWatches;
        const prevStatus = getUserInfo().status;
        setUserInfo((old) => ({
          ...old,
          episodeWatches: old.episodeWatches.filter((id) => id !== episodeId),
          status:
            old.status === "completed" || old.status === "caught_up" ? "watching" : old.status,
        }));

        try {
          await unwatch({ scope: "episode", ids: [episodeId] });
          toast.success(t`Unwatched S${seasonNum} E${epNum}`);
        } catch {
          setUserInfo((old) => ({
            ...old,
            episodeWatches: prevWatches,
            status: prevStatus,
          }));
          toast.error(t`Failed to unmark episode`);
        }
      } else {
        const prevWatches = getUserInfo().episodeWatches;
        const prevStatus = getUserInfo().status;
        const currentWatches = prevWatches;
        const newWatches = currentWatches.includes(episodeId)
          ? currentWatches
          : [...currentWatches, episodeId];

        setUserInfo((old) => ({
          ...old,
          episodeWatches: newWatches,
          status: old.status === null || old.status === "in_watchlist" ? "watching" : old.status,
        }));

        try {
          await watch({ scope: "episode", ids: [episodeId] });

          const watchedSet = new Set(getUserInfo().episodeWatches);
          const previousUnwatched: string[] = [];
          for (const s of seasons) {
            for (const ep of s.episodes) {
              if (
                s.seasonNumber < seasonNum ||
                (s.seasonNumber === seasonNum && ep.episodeNumber < epNum)
              ) {
                if (!watchedSet.has(ep.id) && ep.id !== episodeId) {
                  previousUnwatched.push(ep.id);
                }
              }
            }
          }

          if (previousUnwatched.length > 0) {
            const count = previousUnwatched.length;
            toast.success(t`Watched S${seasonNum} E${epNum}`, {
              description: t`${plural(count, { one: "# earlier episode", other: "# earlier episodes" })} unwatched`,
              action: {
                label: t`Catch up`,
                onClick: () => catchUp(previousUnwatched),
              },
              duration: 8000,
            });
          } else {
            toast.success(t`Watched S${seasonNum} E${epNum}`);
          }
        } catch {
          setUserInfo((old) => ({
            ...old,
            episodeWatches: prevWatches,
            status: prevStatus,
          }));
          toast.error(t`Failed to mark episode`);
        }
      }

      setWatchingEp(null);
    },
    [
      getUserInfo,
      setUserInfo,
      queryClient,
      userInfoKey,
      setWatchingEp,
      seasons,
      catchUp,
      unwatch,
      watch,
      t,
    ],
  );

  const handleMarkSeason = useCallback(
    async (season: Season) => {
      await queryClient.cancelQueries({ queryKey: userInfoKey });
      const prevWatches = getUserInfo().episodeWatches;
      const prevStatus = getUserInfo().status;
      const watchedSet = new Set(prevWatches);
      const unwatched = season.episodes.filter((ep) => !watchedSet.has(ep.id));
      if (unwatched.length === 0) return;

      const newWatchSet = new Set(watchedSet);
      for (const ep of unwatched) newWatchSet.add(ep.id);
      const newWatches = [...newWatchSet];

      setUserInfo((old) => ({
        ...old,
        episodeWatches: newWatches,
        status: old.status === null || old.status === "in_watchlist" ? "watching" : old.status,
      }));

      try {
        await watch({ scope: "season", ids: [season.id] });
        await queryClient.invalidateQueries({ queryKey: userInfoKey });

        const currentWatchSet = new Set(getUserInfo().episodeWatches);
        const previousUnwatched: string[] = [];
        for (const s of seasons) {
          if (s.seasonNumber < season.seasonNumber) {
            for (const ep of s.episodes) {
              if (!currentWatchSet.has(ep.id)) {
                previousUnwatched.push(ep.id);
              }
            }
          }
        }

        const seasonNumber = season.seasonNumber;
        const seasonLabel = season.name ?? t`Season ${seasonNumber}`;
        if (previousUnwatched.length > 0) {
          const count = previousUnwatched.length;
          toast.success(t`Watched all of ${seasonLabel}`, {
            description: t`${plural(count, { one: "# earlier episode", other: "# earlier episodes" })} unwatched`,
            action: {
              label: t`Catch up`,
              onClick: () => catchUp(previousUnwatched),
            },
            duration: 8000,
          });
        } else {
          toast.success(t`Watched all of ${seasonLabel}`);
        }
      } catch {
        setUserInfo((old) => ({
          ...old,
          episodeWatches: prevWatches,
          status: prevStatus,
        }));
        toast.error(t`Failed to mark some episodes`);
      }
    },
    [getUserInfo, setUserInfo, seasons, catchUp, watch, queryClient, userInfoKey, t],
  );

  const handleUnmarkSeason = useCallback(
    async (season: Season) => {
      await queryClient.cancelQueries({ queryKey: userInfoKey });
      const prevWatches = getUserInfo().episodeWatches;
      const prevStatus = getUserInfo().status;
      const seasonEpIds = new Set(season.episodes.map((ep) => ep.id));
      setUserInfo((old) => ({
        ...old,
        episodeWatches: old.episodeWatches.filter((id) => !seasonEpIds.has(id)),
        status: old.status === "completed" || old.status === "caught_up" ? "watching" : old.status,
      }));

      try {
        await unwatch({ scope: "season", ids: [season.id] });
        const seasonNumber = season.seasonNumber;
        const seasonLabel = season.name ?? t`Season ${seasonNumber}`;
        toast.success(t`Unwatched all of ${seasonLabel}`);
      } catch {
        setUserInfo((old) => ({
          ...old,
          episodeWatches: prevWatches,
          status: prevStatus,
        }));
        toast.error(t`Failed to unmark some episodes`);
      }
    },
    [getUserInfo, setUserInfo, queryClient, userInfoKey, unwatch, t],
  );

  const handleMarkAllWatched = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: userInfoKey });
    const prevWatches = getUserInfo().episodeWatches;
    const prevStatus = getUserInfo().status;
    const allEpIds = seasons.flatMap((s) => s.episodes.map((ep) => ep.id));
    setUserInfo((old) => ({
      ...old,
      episodeWatches: allEpIds,
      status: old.status ?? "watching",
    }));
    try {
      await watch({ scope: "series", ids: [titleId] });
      // Refresh to get server-derived display status (caught_up / completed)
      await queryClient.invalidateQueries({ queryKey: userInfoKey });
      toast.success(t`Marked all episodes as watched`);
    } catch {
      setUserInfo((old) => ({
        ...old,
        episodeWatches: prevWatches,
        status: prevStatus,
      }));
      toast.error(t`Failed to mark all episodes as watched`);
    }
  }, [getUserInfo, setUserInfo, seasons, titleId, watch, queryClient, userInfoKey, t]);

  const handleRewatch = useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: userInfoKey });
    const prevWatches = getUserInfo().episodeWatches;
    const prevStatus = getUserInfo().status;
    // New cycle starts with nothing watched — reflects immediately even
    // before the server round-trip confirms it.
    setUserInfo((old) => ({ ...old, episodeWatches: [], status: "watching" }));
    try {
      await rewatch({ id: titleId });
      await queryClient.invalidateQueries({ queryKey: orpc.library.continueWatching.key() });
      await queryClient.invalidateQueries({ queryKey: orpc.library.list.key() });
      toast.success(t`Watching "${titleName}" again from the start`);
    } catch {
      setUserInfo((old) => ({ ...old, episodeWatches: prevWatches, status: prevStatus }));
      toast.error(t`Failed to start rewatch`);
    }
  }, [getUserInfo, setUserInfo, queryClient, userInfoKey, titleId, titleName, rewatch, t]);

  return {
    handleStatusChange,
    handleRating,
    handleWatchMovie,
    handleUnwatchMovie,
    handleWatchEpisode,
    handleMarkSeason,
    handleUnmarkSeason,
    handleMarkAllWatched,
    handleRewatch,
  };
}
