import { Trans, useLingui } from "@lingui/react/macro";
import { IconDeviceTv, IconLoader, IconPlayerPlay } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { orpc } from "@/lib/orpc/client";

interface PlayOnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: { titleId: string } | { episodeId: string };
}

/**
 * "Lire sur..." (01.09, Sid) — remote-controls another Emby session (e.g.
 * the living room TV's native Emby app) to start playing, the same
 * mechanism Emby's own apps use to cast between devices on one account.
 * Only lists this user's saved shortlist (see Settings → the Emby
 * integration card's "Playback devices" picker) — not the whole
 * household's device list.
 */
export function PlayOnDialog({ open, onOpenChange, target }: PlayOnDialogProps) {
  const { t } = useLingui();
  const favoritesQuery = useQuery({
    ...orpc.playbackDevices.listFavorites.queryOptions(),
    enabled: open,
  });
  const playMutation = useMutation(orpc.playbackDevices.playOn.mutationOptions());

  async function handlePlay(embyDeviceId: string) {
    try {
      await playMutation.mutateAsync({ embyDeviceId, ...target });
      toast.success(t`Playback started`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t`Failed to start playback`);
    }
  }

  const devices = favoritesQuery.data?.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Play on...</Trans>
          </DialogTitle>
          <DialogDescription>
            <Trans>Starts playback directly on the device's own Emby app.</Trans>
          </DialogDescription>
        </DialogHeader>
        {favoritesQuery.isPending ? (
          <IconLoader className="mx-auto size-5 animate-spin" />
        ) : devices.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            <Trans>
              No devices saved yet — pick some in Settings, under your Emby integration.
            </Trans>
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {devices.map((device) => (
              <Button
                key={device.embyDeviceId}
                variant="outline"
                disabled={!device.online || playMutation.isPending}
                onClick={() => handlePlay(device.embyDeviceId)}
                className="h-auto justify-start px-3 py-2"
              >
                <IconDeviceTv aria-hidden={true} className="size-4 shrink-0" />
                <span className="flex flex-1 flex-col items-start text-start">
                  <span>{device.embyDeviceName}</span>
                  <span className="text-muted-foreground text-xs">
                    {device.online
                      ? (device.nowPlaying ?? t`Online`)
                      : t`Offline — open Emby on this device first`}
                  </span>
                </span>
                <IconPlayerPlay aria-hidden={true} className="size-4 shrink-0" />
              </Button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
