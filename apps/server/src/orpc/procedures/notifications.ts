import { upsertPushSubscription, deletePushSubscriptionByEndpoint } from "@sofa/db/queries/push";

import { os } from "../context";
import { authed } from "../middleware";

export const subscribe = os.notifications.subscribe
  .use(authed)
  .handler(({ input, context }) => {
    upsertPushSubscription({
      userId: context.user.id,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgent: context.headers.get("user-agent"),
    });
  });

export const unsubscribe = os.notifications.unsubscribe.use(authed).handler(({ input }) => {
  deletePushSubscriptionByEndpoint(input.endpoint);
});
