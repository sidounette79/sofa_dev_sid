import { eq, inArray } from "drizzle-orm";

import { db } from "../client";
import { pushSubscriptions } from "../schema";

export function upsertPushSubscription(values: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}) {
  return db
    .insert(pushSubscriptions)
    .values({ ...values, createdAt: new Date() })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: values.p256dh, auth: values.auth, userAgent: values.userAgent },
    })
    .returning();
}

export async function deletePushSubscriptionByEndpoint(endpoint: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
}

export async function deletePushSubscriptionsByEndpoints(endpoints: string[]): Promise<void> {
  if (endpoints.length === 0) return;
  await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.endpoint, endpoints));
}

export function getPushSubscriptionsForUser(userId: string) {
  return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
}

export function getPushSubscriptionsForUsers(userIds: string[]) {
  if (userIds.length === 0) return Promise.resolve([]);
  return db.select().from(pushSubscriptions).where(inArray(pushSubscriptions.userId, userIds));
}
