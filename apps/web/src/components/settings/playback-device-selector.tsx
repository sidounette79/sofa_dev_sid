import { useLingui } from "@lingui/react/macro";
import { IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { orpc } from "@/lib/orpc/client";

const MAX_FAVORITE_DEVICES = 5;

/**
 * 01.09, Sid — "Lire sur..." favorites picker. A household Emby server has
 * every phone/tablet/TV any family member has ever connected with — this
 * lets each Sofa user pick just the 2-3 devices *they* actually want to
 * see in the "Lire sur..." menu, instead of the full list every time.
 * Deliberately scoped to the current user's own Emby account
 * (listAvailable filters by LastUserId server-side) — she never sees her
 * sister's or XA's devices here, only her own.
 */
export function PlaybackDeviceSelector() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const { data: available, isPending: availablePending } = useQuery(
    orpc.playbackDevices.listAvailable.queryOptions(),
  );
  const { data: favorites, isPending: favoritesPending } = useQuery(
    orpc.playbackDevices.listFavorites.queryOptions(),
  );
  const [selected, setSelected] = useState<string[] | null>(null);

  useEffect(() => {
    if (favorites && selected === null) {
      setSelected(favorites.items.map((d) => d.embyDeviceId));
    }
  }, [favorites, selected]);

  const saveMutation = useMutation(
    orpc.playbackDevices.setFavorites.mutationOptions({
      onSuccess: () => {
        toast.success(t`Playback devices saved`);
        queryClient.invalidateQueries({
          queryKey: orpc.playbackDevices.listFavorites.queryOptions().queryKey,
        });
      },
      onError: () => toast.error(t`Failed to save playback devices`),
    }),
  );

  const dismissMutation = useMutation(
    orpc.playbackDevices.dismiss.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.playbackDevices.listAvailable.queryOptions().queryKey,
        });
      },
      onError: () => toast.error(t`Failed to hide device`),
    }),
  );

  if (availablePending || favoritesPending || !available) return null;
  if (available.items.length === 0) return null;

  function toggle(embyDeviceId: string, checked: boolean) {
    if (!available) return;
    const current = selected ?? [];
    if (checked && current.length >= MAX_FAVORITE_DEVICES) {
      toast.error(t`You can pick up to ${MAX_FAVORITE_DEVICES} devices`);
      return;
    }
    const next = checked
      ? [...current, embyDeviceId]
      : current.filter((id) => id !== embyDeviceId);
    setSelected(next);
    saveMutation.mutate({
      devices: available.items
        .filter((d) => next.includes(d.embyDeviceId))
        .map((d) => ({ embyDeviceId: d.embyDeviceId, embyDeviceName: d.embyDeviceName })),
    });
  }

  const currentSelection = selected ?? favorites?.items.map((d) => d.embyDeviceId) ?? [];

  return (
    <div>
      <Label className="text-muted-foreground mb-2">{t`Playback devices ("Play on...")`}</Label>
      <p className="text-muted-foreground/70 mb-2 text-xs">
        {t`Pick a few of your Emby devices to show in the "Play on..." menu — up to ${MAX_FAVORITE_DEVICES}, instead of every device you've ever used. The × permanently hides a device you'll never want (e.g. an old phone) — it won't come back here.`}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {available.items.map((device) => (
          <div key={device.embyDeviceId} className="flex items-center gap-1">
            <label className="flex min-w-0 cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={currentSelection.includes(device.embyDeviceId)}
                onCheckedChange={(checked) => toggle(device.embyDeviceId, checked === true)}
              />
              <span className="truncate">{device.embyDeviceName}</span>
            </label>
            <button
              type="button"
              aria-label={t`Hide ${device.embyDeviceName} permanently`}
              onClick={() => dismissMutation.mutate({ embyDeviceId: device.embyDeviceId })}
              className="text-muted-foreground/50 hover:text-destructive shrink-0"
            >
              <IconX className="size-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
