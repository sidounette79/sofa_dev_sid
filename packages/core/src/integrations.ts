import {
  deleteIntegrationByUserAndProvider,
  getIntegrationByToken,
  getIntegrationByUserAndProvider,
  getRecentEventsForIntegrations,
  getUserIntegrations,
  insertIntegration,
  regenerateIntegrationToken,
  updateIntegrationEmbyUsername,
  updateIntegrationEnabled,
} from "@sofa/db/queries/integrations";

const LIST_PROVIDERS = new Set(["sonarr", "radarr"]);

function integrationTypeFor(provider: string): "webhook" | "list" {
  return LIST_PROVIDERS.has(provider) ? "list" : "webhook";
}

function generateToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
}

function serializeIntegration(row: {
  id: string;
  provider: string;
  type: "webhook" | "list";
  token: string;
  embyUsername: string | null;
  enabled: boolean;
  lastEventAt: Date | null;
  createdAt: Date;
}) {
  return {
    ...row,
    lastEventAt: row.lastEventAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listUserIntegrations(userId: string) {
  const userIntegrations = await getUserIntegrations(userId);

  const integrationIds = userIntegrations.map((i) => i.id);
  const eventsByIntegration = await getRecentEventsForIntegrations(integrationIds);

  const result = userIntegrations.map((integration) => {
    const events = eventsByIntegration.get(integration.id) ?? [];
    return Object.assign(serializeIntegration(integration), {
      recentEvents: events.map((e) => ({
        id: e.id,
        eventType: e.eventType,
        mediaType: e.mediaType,
        mediaTitle: e.mediaTitle,
        status: e.status,
        receivedAt: e.receivedAt.toISOString(),
      })),
    });
  });

  return { integrations: result };
}

export async function createOrUpdateIntegration(
  userId: string,
  provider: string,
  enabled?: boolean,
) {
  const [existing] = await getIntegrationByUserAndProvider(userId, provider);

  if (existing) {
    if (enabled !== undefined) {
      const [row] = await updateIntegrationEnabled(existing.id, enabled);
      return serializeIntegration(row);
    }
    return serializeIntegration(existing);
  }

  const [row] = await insertIntegration({
    userId,
    provider,
    type: integrationTypeFor(provider),
    token: generateToken(),
    enabled: enabled ?? true,
    createdAt: new Date(),
  });

  return serializeIntegration(row);
}

export async function deleteIntegration(userId: string, provider: string): Promise<void> {
  await deleteIntegrationByUserAndProvider(userId, provider);
}

export async function regenerateToken(userId: string, provider: string) {
  return regenerateIntegrationToken(userId, provider, generateToken());
}

export async function findIntegrationByToken(token: string) {
  const [row] = await getIntegrationByToken(token);
  return row;
}

export async function setEmbyUsername(userId: string, embyUsername: string | null) {
  const [row] = await updateIntegrationEmbyUsername(userId, "emby", embyUsername);
  return row ? serializeIntegration(row) : null;
}

export { serializeIntegration };
