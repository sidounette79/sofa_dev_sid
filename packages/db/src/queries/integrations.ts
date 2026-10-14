import { and, desc, eq } from "drizzle-orm";

import { db } from "../client";
import { integrationEvents, integrations } from "../schema";

export function getUserIntegrations(userId: string) {
  return db.select().from(integrations).where(eq(integrations.userId, userId));
}

export function getRecentEventsForIntegration(integrationId: string, limit = 10) {
  return db
    .select()
    .from(integrationEvents)
    .where(eq(integrationEvents.integrationId, integrationId))
    .orderBy(desc(integrationEvents.receivedAt))
    .limit(limit)
    ;
}

export async function getRecentEventsForIntegrations(integrationIds: string[], limit = 10) {
  type Event = Awaited<ReturnType<typeof getRecentEventsForIntegration>>[number];
  const result = new Map<string, Event[]>();
  if (integrationIds.length === 0) return result;

  for (const integrationId of integrationIds) {
    const events = await getRecentEventsForIntegration(integrationId, limit);
    if (events.length > 0) result.set(integrationId, events);
  }
  return result;
}

export function getIntegrationByUserAndProvider(userId: string, provider: string) {
  return db
    .select()
    .from(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)))
    ;
}

export function updateIntegrationEnabled(integrationId: string, enabled: boolean) {
  return db
    .update(integrations)
    .set({ enabled })
    .where(eq(integrations.id, integrationId))
    .returning()
    ;
}

export function insertIntegration(values: typeof integrations.$inferInsert) {
  return db.insert(integrations).values(values).returning();
}

export async function deleteIntegrationByUserAndProvider(
  userId: string,
  provider: string,
): Promise<void> {
  await db
    .delete(integrations)
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)));
}

export function regenerateIntegrationToken(userId: string, provider: string, newToken: string) {
  return db
    .update(integrations)
    .set({ token: newToken })
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)))
    .returning()
    ;
}

export function getIntegrationByToken(token: string) {
  return db.select().from(integrations).where(eq(integrations.token, token));
}

/** 31.08, Sid — safety net for a webhook lost while Sofa was down (no
 * retry/queue on Sofa's side for that case, see webhooks.ts): every
 * enabled Emby webhook integration with a linked Emby account, so a
 * periodic job can diff Emby's real "played" state against Sofa's. */
export async function getEnabledEmbyIntegrationsWithUsername() {
  const rows = await db
    .select({ userId: integrations.userId, embyUsername: integrations.embyUsername })
    .from(integrations)
    .where(
      and(
        eq(integrations.provider, "emby"),
        eq(integrations.type, "webhook"),
        eq(integrations.enabled, true),
      ),
    );
  return rows.filter(
    (row): row is { userId: string; embyUsername: string } => row.embyUsername !== null,
  );
}
export function updateIntegrationEmbyUsername(
  userId: string,
  provider: string,
  embyUsername: string | null,
) {
  return db
    .update(integrations)
    .set({ embyUsername })
    .where(and(eq(integrations.userId, userId), eq(integrations.provider, provider)))
    .returning()
    ;
}
