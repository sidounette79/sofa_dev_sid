import { Trans, useLingui } from "@lingui/react/macro";
import { IconBell } from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { orpc } from "@/lib/orpc/client";
import {
  getExistingPushSubscription,
  isPushSupported,
  serializeSubscription,
  subscribeToPush,
} from "@/lib/push";

export function NotificationsSection() {
  const { t } = useLingui();
  const { data: publicInfo, isPending: isLoadingInfo } = useQuery(
    orpc.system.publicInfo.queryOptions(),
  );
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [isPending, startTransition] = useTransition();
  const subscribeMutation = useMutation(orpc.notifications.subscribe.mutationOptions());
  const unsubscribeMutation = useMutation(orpc.notifications.unsubscribe.mutationOptions());

  useEffect(() => {
    getExistingPushSubscription().then((sub) => {
      setSubscribed(sub !== null);
      // 26.11, Sid : « pourtant, dans mon compte, les notifs ont toujours
      // été activées » — et l'interrupteur le disait bien, à tort.
      //
      // Il ne regardait que le navigateur. Or le serveur supprime tout
      // abonnement auquel le service de push répond 404/410 (voir le
      // pruning dans core/push.ts). Après ça, le navigateur garde le
      // sien, l'interrupteur reste allumé, et plus rien n'est jamais
      // envoyé : son compte n'avait plus AUCUN abonnement enregistré
      // alors que l'écran affichait « activées ».
      //
      // On le ré-enregistre donc à chaque ouverture de l'écran. L'appel
      // est un upsert sur l'endpoint (queries/push.ts), donc sans effet
      // s'il est déjà connu, et il répare tout seul la désynchronisation.
      if (sub) subscribeMutation.mutate(serializeSubscription(sub));
    });
    // Au montage uniquement : re-synchroniser à chaque rendu n'apporterait
    // rien et multiplierait les écritures.
  }, []);

  if (isLoadingInfo || subscribed === null) {
    return (
      <CardContent>
        <Skeleton className="h-12 w-full" />
      </CardContent>
    );
  }

  const supported = isPushSupported() && !!publicInfo?.vapidPublicKey;

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      try {
        if (checked) {
          if (Notification.permission === "denied") {
            toast.error(t`Notifications are blocked in your browser settings`);
            return;
          }
          const permission =
            Notification.permission === "granted"
              ? "granted"
              : await Notification.requestPermission();
          if (permission !== "granted") {
            toast.error(t`Notification permission denied`);
            return;
          }
          // publicInfo.vapidPublicKey is guaranteed here — `supported` above
          // already gates the switch itself off when it's null.
          const subscription = await subscribeToPush(publicInfo!.vapidPublicKey!);
          await subscribeMutation.mutateAsync(serializeSubscription(subscription));
          setSubscribed(true);
          toast.success(t`Notifications enabled`);
        } else {
          const subscription = await getExistingPushSubscription();
          if (subscription) {
            await unsubscribeMutation.mutateAsync({ endpoint: subscription.endpoint });
            await subscription.unsubscribe();
          }
          setSubscribed(false);
          toast.success(t`Notifications disabled`);
        }
      } catch {
        toast.error(t`Failed to update notification settings`);
      }
    });
  }

  return (
    <CardContent>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="bg-primary/10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
            <IconBell aria-hidden={true} className="text-primary size-4" />
          </div>
          <div>
            <CardTitle>
              <Trans>Notifications</Trans>
            </CardTitle>
            <CardDescription>
              {supported ? (
                <Trans>Get notified when a new episode airs or a series' status changes</Trans>
              ) : (
                <Trans>Not supported in this browser</Trans>
              )}
            </CardDescription>
          </div>
        </div>
        <Switch
          checked={subscribed}
          onCheckedChange={handleToggle}
          disabled={isPending || !supported}
          aria-label={t`Toggle notifications`}
        />
      </div>
    </CardContent>
  );
}
