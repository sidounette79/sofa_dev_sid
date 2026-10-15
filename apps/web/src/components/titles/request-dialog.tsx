import { Trans, useLingui } from "@lingui/react/macro";
import { IconDownload, IconLoader } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { orpc } from "@/lib/orpc/client";
import { ORPCError } from "@orpc/client";
import { AppErrorCode } from "@sofa/api/errors";
import type { Season } from "@sofa/api/schemas";

interface RequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
  titleType: "movie" | "tv";
  seasons: Season[];
}

/**
 * Jellyseerr-style request dialog (24.08, Sid) — pick a root folder + quality
 * profile (falling back to the requesting user's saved default, see the
 * "Media Requests" admin settings section) and, for a series, which seasons
 * to actually download ("pas retélécharger une saison déjà vue il y a
 * longtemps"). Separate from the plain "Watchlist" button (StatusButton),
 * which still just marks interest without touching Radarr/Sonarr directly.
 */
export function RequestDialog({
  open,
  onOpenChange,
  titleId,
  titleType,
  seasons,
}: RequestDialogProps) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const optionsQuery = useQuery({ ...orpc.mediaRequests.getOptions.queryOptions(), enabled: open });
  const defaultsQuery = useQuery({
    ...orpc.mediaRequests.getMyDefaults.queryOptions(),
    enabled: open,
  });

  const [rootFolderPath, setRootFolderPath] = useState<string | undefined>(undefined);
  const [qualityProfileId, setQualityProfileId] = useState<number | undefined>(undefined);
  const [selectedSeasons, setSelectedSeasons] = useState<Set<number> | null>(null);

  const requestMovieMutation = useMutation(orpc.mediaRequests.requestMovie.mutationOptions());
  const requestSeriesMutation = useMutation(orpc.mediaRequests.requestSeries.mutationOptions());
  const isPending = requestMovieMutation.isPending || requestSeriesMutation.isPending;

  const options = optionsQuery.data?.[titleType === "movie" ? "radarr" : "sonarr"];
  const defaults = defaultsQuery.data;
  const effectiveRootFolder =
    rootFolderPath ??
    (titleType === "movie" ? defaults?.radarrRootFolder : defaults?.sonarrRootFolder) ??
    undefined;
  const effectiveQualityProfileId =
    qualityProfileId ??
    (titleType === "movie" ? defaults?.radarrQualityProfileId : defaults?.sonarrQualityProfileId) ??
    undefined;

  function toggleSeason(seasonNumber: number) {
    setSelectedSeasons((prev) => {
      // Lazily initialize to "every season" the first time the user touches
      // one, then remove/add just that one.
      const base = prev ?? new Set(seasons.map((s) => s.seasonNumber));
      const next = new Set(base);
      if (next.has(seasonNumber)) next.delete(seasonNumber);
      else next.add(seasonNumber);
      return next;
    });
  }

  async function handleSubmit() {
    if (!effectiveRootFolder || !effectiveQualityProfileId) return;
    try {
      if (titleType === "movie") {
        await requestMovieMutation.mutateAsync({
          id: titleId,
          rootFolderPath: effectiveRootFolder,
          qualityProfileId: effectiveQualityProfileId,
        });
      } else {
        await requestSeriesMutation.mutateAsync({
          id: titleId,
          rootFolderPath: effectiveRootFolder,
          qualityProfileId: effectiveQualityProfileId,
          seasonNumbers: selectedSeasons ? [...selectedSeasons] : undefined,
        });
      }
      toast.success(t`Request sent`);
      onOpenChange(false);
      // 14.10, Sid: real crash confirmed live (Android, request dialog) -
      // "Failed to execute 'removeChild' on 'Node'". Invalidating in the
      // same tick as closing the dialog re-renders the title page's
      // Request button (-> "Requested") while Base UI's own animated
      // portal unmount is still removing the dialog's DOM nodes; the two
      // DOM mutations race. Deferring past the dialog's close animation
      // (duration-100 in dialog.tsx) avoids the overlap.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: orpc.tracking.userInfo.key() });
      }, 150);
    } catch (err) {
      // 06.09, Sid: TheTVDB not having indexed the show yet (usually because
      // it hasn't aired) is an expected, temporary state, not a real
      // failure — she asked for this to read as "on hold", not an error.
      // See NoTvdbIdError / unresolvedSeriesRequests: the attempt is saved
      // and shows up under "En attente TMDB" with a Retry.
      if (err instanceof ORPCError && err.data?.code === AppErrorCode.NO_TVDB_ID) {
        toast.info(t`Not available yet — saved, we'll retry automatically`);
        queryClient.invalidateQueries({ queryKey: orpc.mediaRequests.listUnresolvedSeriesRequests.key() });
        onOpenChange(false);
        return;
      }
      toast.error(t`Failed to send request`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Request</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Choose a root folder and quality profile. This searches and downloads immediately —
              unlike the plain Watchlist button, which just marks interest.
            </Trans>
          </DialogDescription>
        </DialogHeader>

        {optionsQuery.isPending || defaultsQuery.isPending ? (
          <div className="text-muted-foreground flex items-center justify-center py-8 text-sm">
            <IconLoader className="mr-2 size-4 animate-spin" />
            <Trans>Loading options…</Trans>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">
                <Trans>Root folder</Trans>
              </p>
              <Select
                value={effectiveRootFolder}
                onValueChange={(v) => setRootFolderPath(v ?? undefined)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t`Choose a folder`} />
                </SelectTrigger>
                <SelectContent>
                  {options?.rootFolders.map((f) => (
                    <SelectItem key={f.path} value={f.path}>
                      {f.path}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <p className="text-muted-foreground text-xs">
                <Trans>Quality profile</Trans>
              </p>
              <Select
                value={effectiveQualityProfileId ? String(effectiveQualityProfileId) : undefined}
                onValueChange={(v) => setQualityProfileId(Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t`Choose a profile`}>
                    {(value: string | null) =>
                      options?.qualityProfiles.find((p) => String(p.id) === value)?.name ?? value
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {options?.qualityProfiles.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {titleType === "tv" && seasons.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-muted-foreground text-xs">
                  <Trans>Seasons</Trans>
                </p>
                <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                  {seasons.map((season) => {
                    const checked = selectedSeasons
                      ? selectedSeasons.has(season.seasonNumber)
                      : true;
                    return (
                      <label
                        key={season.id}
                        className="flex cursor-pointer items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleSeason(season.seasonNumber)}
                        />
                        {season.name ?? t`Season ${season.seasonNumber}`}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <Trans>Cancel</Trans>
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !effectiveRootFolder || !effectiveQualityProfileId}
          >
            {isPending ? (
              <IconLoader key="loading" className="size-4 animate-spin" />
            ) : (
              <IconDownload key="download" className="size-4" />
            )}
            <Trans>Request</Trans>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
