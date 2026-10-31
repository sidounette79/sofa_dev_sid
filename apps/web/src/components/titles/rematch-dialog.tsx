import { Trans, useLingui } from "@lingui/react/macro";
import { IconLoader } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useDebounce } from "@/hooks/use-debounce";
import { orpc } from "@/lib/orpc/client";

interface RematchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
}

// 31.10, Sid ("j'ai des trucs complètement faux alors qu'ils sont juste
// dans sonarr et dans emby... comme le prisonnier, brothers et la loi et
// l'ordre... faut que je puisse aller chercher le truc juste sur tvdb ou
// tmdb") - same-named shows across decades can trip the automatic TMDB
// crossref (resolveShowTmdbId/resolveMovieTmdbId) even within its
// existing year-plausibility guard. Lets her search TMDB directly and
// pick the right entry by hand.
export function RematchDialog({ open, onOpenChange, titleId }: RematchDialogProps) {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query.trim(), 300);
  const [confirming, setConfirming] = useState<{ tmdbId: number; label: string } | null>(null);
  const confirmingLabel = confirming?.label;

  const search = useQuery({
    ...orpc.admin.titleRematchSearch.queryOptions({
      input: { id: titleId, query: debouncedQuery },
    }),
    enabled: debouncedQuery.length > 0,
  });

  const rematch = useMutation(
    orpc.admin.titleRematch.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.titles.key() });
        toast.success(t`Title re-matched`);
        setConfirming(null);
        onOpenChange(false);
      },
      onError: (error: Error) => toast.error(error.message || t`Re-match failed`),
    }),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirming(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Correct TMDB match</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>
              Search TMDB directly when the automatic match picked the wrong entry (e.g. a
              same-named show from a different decade).
            </Trans>
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="space-y-4">
            <p className="text-sm">
              <Trans>Re-match this title to "{confirmingLabel}"?</Trans>
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirming(null)}
                disabled={rematch.isPending}
                className="border-border hover:bg-muted rounded-lg border px-4 py-2 text-sm"
              >
                <Trans>Cancel</Trans>
              </button>
              <button
                type="button"
                onClick={() => rematch.mutate({ id: titleId, tmdbId: confirming.tmdbId })}
                disabled={rematch.isPending}
                className="bg-destructive text-destructive-foreground flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm"
              >
                {rematch.isPending && <IconLoader className="size-3.5 animate-spin" />}
                <Trans>Re-match</Trans>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t`Search by exact title and year...`}
            />
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {debouncedQuery.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  <Trans>Type the title and year to narrow it down (e.g. "Brothers 2009")</Trans>
                </p>
              ) : search.isPending ? (
                <div className="text-muted-foreground flex items-center justify-center py-6 text-sm">
                  <IconLoader className="mr-2 size-4 animate-spin" />
                  <Trans>Searching…</Trans>
                </div>
              ) : search.data?.results.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                  <Trans>No results for "{debouncedQuery}"</Trans>
                </p>
              ) : (
                search.data?.results.map((candidate) => (
                  <button
                    key={candidate.tmdbId}
                    type="button"
                    onClick={() =>
                      setConfirming({
                        tmdbId: candidate.tmdbId,
                        label: `${candidate.title}${candidate.year ? ` (${candidate.year})` : ""}`,
                      })
                    }
                    className="hover:bg-muted flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left"
                  >
                    <div className="bg-secondary h-16 w-11 shrink-0 overflow-hidden rounded-md">
                      {candidate.posterUrl && (
                        // biome-ignore lint/performance/noImgElement: small search-result thumbnail, same pattern as title-hero.tsx
                        <img
                          src={candidate.posterUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{candidate.title}</p>
                      {candidate.year && (
                        <p className="text-muted-foreground text-xs">{candidate.year}</p>
                      )}
                      {candidate.overview && (
                        <p className="text-muted-foreground mt-0.5 line-clamp-2 text-xs">
                          {candidate.overview}
                        </p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
