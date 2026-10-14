import { Trans } from "@lingui/react/macro";
import { IconDeviceTv, IconFolderSymlink, IconServer2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { orpc } from "@/lib/orpc/client";

import { PlayOnDialog } from "./play-on-dialog";
import { useTitleContext, useTitleUserInfo } from "./title-context";

export function TitleEmbyAvailability({
  embyStatus,
  embyLibraryName,
  embyItemId,
  embyServerId,
  embyUrl,
}: {
  embyStatus: "available" | "removed" | null;
  embyLibraryName: string | null;
  embyItemId: string | null;
  embyServerId: string | null;
  embyUrl: string | null;
}) {
  const { titleId } = useTitleContext();
  const { requestedAt } = useTitleUserInfo();
  const isAvailable = embyStatus === "available";
  const [playOnDialogOpen, setPlayOnDialogOpen] = useState(false);

  // 28.08, Sid — "dans quelle bibliothèque ira-t-il" for a requested-but-
  // not-available title: same idea as "Available on your server" below, for
  // the pending case. Only fetched when there's actually something to show
  // (a live Radarr/Sonarr lookup, not free) — see titles.pendingLibrary's
  // own doc comment for why this isn't just read from userRequestDefaults.
  const { data: pendingLibrary } = useQuery({
    ...orpc.titles.pendingLibrary.queryOptions({ input: { id: titleId } }),
    enabled: !isAvailable && !!requestedAt,
  });

  if (!embyStatus) {
    if (!requestedAt || !pendingLibrary?.rootFolderPath) return null;
    return (
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <div className="text-primary flex items-center gap-1.5 text-sm font-medium">
          <IconFolderSymlink aria-hidden={true} className="size-4" />
          <Trans>Will go to — {pendingLibrary.rootFolderPath}</Trans>
        </div>
      </div>
    );
  }
  const deepLink =
    isAvailable && embyItemId && embyServerId && embyUrl
      ? `${embyUrl}/web/index.html#!/item?id=${embyItemId}&serverId=${embyServerId}`
      : null;

  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <div
        className={`flex items-center gap-1.5 text-sm font-medium ${isAvailable ? "text-status-completed" : "text-destructive"}`}
      >
        <IconServer2 aria-hidden={true} className="size-4" />
        {isAvailable ? (
          embyLibraryName ? (
            <Trans>Available on your server — {embyLibraryName}</Trans>
          ) : (
            <Trans>Available on your server</Trans>
          )
        ) : embyLibraryName ? (
          <Trans>No longer on your server — was in {embyLibraryName}</Trans>
        ) : (
          <Trans>No longer on your server</Trans>
        )}
      </div>
      {deepLink ? (
        <a
          href={deepLink}
          className="border-status-completed/30 text-status-completed hover:bg-status-completed/10 flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
        >
          <IconDeviceTv aria-hidden={true} className="size-3.5" />
          <Trans>Play in Emby</Trans>
        </a>
      ) : null}
      {isAvailable && (
        <button
          type="button"
          onClick={() => setPlayOnDialogOpen(true)}
          className="border-status-completed/30 text-status-completed hover:bg-status-completed/10 flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors"
        >
          <IconDeviceTv aria-hidden={true} className="size-3.5" />
          <Trans>Play on...</Trans>
        </button>
      )}
      {isAvailable && (
        <PlayOnDialog
          open={playOnDialogOpen}
          onOpenChange={setPlayOnDialogOpen}
          target={{ titleId }}
        />
      )}
    </div>
  );
}
