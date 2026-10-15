import { Trans, useLingui } from "@lingui/react/macro";
import {
  IconCheck,
  IconClockCheck,
  IconDotsVertical,
  IconDownload,
  IconRepeat,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { Fragment, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";

import { RequestDialog } from "./request-dialog";
import { StarRating } from "./star-rating";
import { StatusButton } from "./status-button";
import { useTitleContext, useTitleUserInfo } from "./title-context";
import { useTitleActions } from "./use-title-actions";

export function TitleActions() {
  const { t } = useLingui();
  const { titleId, titleType, seasons } = useTitleContext();
  const { userStatus, userRating, requestedAt, embyStatus } = useTitleUserInfo();
  const { handleStatusChange, handleRating, handleWatchMovie, handleUnwatchMovie, handleRewatch } =
    useTitleActions();
  const isMovieWatched = userStatus === "completed";
  const isDropped = userStatus === "dropped";
  const canRewatchSeries =
    titleType === "tv" && (userStatus === "completed" || userStatus === "caught_up");
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Sid's ask (25.08): hide the "+ Watchlist" add button — she doesn't
          use the passive watchlist, her workflow is Request. Still shown
          once a real status exists (auto-tracked, watching, completed...)
          since that's how she removes a title from her library entirely. */}
      {userStatus != null && (
        <StatusButton currentStatus={userStatus} onChange={handleStatusChange} />
      )}
      {/* 25.08, Sid — real bug found live (logged in as Mary): this button
          only ever checked requestedAt, so a title already available in
          Emby under someone else's library folder (embyStatus ===
          "available", title-level, not per-user) could still be
          "requested" again from here. Same fix as the grid-card "+". */}
      <Button
        onClick={() => setRequestDialogOpen(true)}
        // 06.09, Sid: Request is her actual primary workflow (she doesn't
        // use the passive watchlist), so it should carry some color — but a
        // solid fill read as too "violent" next to Mark Watched. Soft tint
        // instead (same treatment StatusButton already uses for its own "+"
        // add action), dropped once it's done (Requested/Available) since a
        // resolved action matters less than a pending one.
        variant="outline"
        size="lg"
        disabled={!!requestedAt || embyStatus === "available"}
        className={`h-9 rounded-lg px-4 text-sm hover:shadow-md active:scale-[0.97] disabled:opacity-70 ${!requestedAt && embyStatus !== "available" ? "bg-primary/10 text-primary ring-1 ring-primary/20 hover:bg-primary/15 hover:ring-primary/30 border-transparent" : ""}`}
      >
        {embyStatus === "available" ? (
          <Fragment key="available">
            <IconCheck aria-hidden={true} className="text-primary size-3.5" />
            <Trans>Available</Trans>
          </Fragment>
        ) : requestedAt ? (
          <Fragment key="requested">
            <IconClockCheck aria-hidden={true} className="text-primary size-3.5" />
            <Trans>Requested</Trans>
          </Fragment>
        ) : (
          <Fragment key="request">
            <IconDownload aria-hidden={true} className="size-3.5" />
            <Trans>Request</Trans>
          </Fragment>
        )}
      </Button>
      <RequestDialog
        open={requestDialogOpen}
        onOpenChange={setRequestDialogOpen}
        titleId={titleId}
        titleType={titleType}
        seasons={seasons}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          className="border-border/50 hover:border-primary/30 hover:bg-card flex h-9 w-9 items-center justify-center rounded-lg border transition-colors"
          aria-label={t`More actions`}
        >
          <IconDotsVertical className="text-muted-foreground size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem
            onClick={() => handleStatusChange(isDropped ? "watchlist" : "dropped")}
            className="text-destructive cursor-pointer text-[13px]"
          >
            <IconTrash className="size-3.5" />
            {isDropped ? t`Remove Dropped Status` : t`Mark as Dropped`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {titleType === "movie" && (
        <Button
          onClick={isMovieWatched ? handleUnwatchMovie : handleWatchMovie}
          // 06.09, Sid: this auto-updates itself from Emby the moment she
          // actually watches something — manually clicking it is a fallback
          // for gaps, not her main workflow (unlike Request, right above),
          // so it shouldn't visually outweigh it. Soft status-completed
          // tint (same green family as StatusButton's own "completed"
          // look) instead of a solid fill, in both directions.
          variant={isMovieWatched ? "destructive" : "outline"}
          size="lg"
          className={`h-9 rounded-lg px-4 text-sm hover:shadow-md active:scale-[0.97] ${isMovieWatched ? "hover:shadow-destructive/20" : "bg-status-completed/10 text-status-completed ring-1 ring-status-completed/20 hover:bg-status-completed/15 hover:ring-status-completed/30 border-transparent"}`}
        >
          {isMovieWatched ? (
            <Fragment key="unwatched">
              <IconX aria-hidden={true} className="size-3.5" />
              <Trans>Mark Unwatched</Trans>
            </Fragment>
          ) : (
            <Fragment key="watched">
              <IconCheck aria-hidden={true} className="size-3.5" />
              <Trans>Mark Watched</Trans>
            </Fragment>
          )}
        </Button>
      )}
      {canRewatchSeries && (
        <Button
          onClick={handleRewatch}
          variant="outline"
          size="lg"
          className="h-9 rounded-lg px-4 text-sm hover:shadow-md active:scale-[0.97]"
        >
          <IconRepeat aria-hidden={true} className="size-3.5" />
          <Trans>Watch Again</Trans>
        </Button>
      )}
      <Separator orientation="vertical" className="bg-border/50 mx-0.5 my-auto h-6" />
      <StarRating value={userRating ?? 0} onChange={handleRating} />
    </div>
  );
}
