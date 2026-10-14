import { beforeEach, describe, expect, test } from "vitest";

import { clearAllTables, insertUser } from "@sofa/test/db";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T/;

import {
  createOrUpdateIntegration,
  deleteIntegration,
  findIntegrationByToken,
  listUserIntegrations,
  regenerateToken,
} from "../src/integrations";

beforeEach(async () => {
  await clearAllTables();
  await insertUser("user-1");
});

describe("createOrUpdateIntegration", () => {
  test("creates a new webhook integration", async () => {
    const result = await createOrUpdateIntegration("user-1", "jellyfin");
    expect(result.provider).toBe("jellyfin");
    expect(result.type).toBe("webhook");
    expect(result.enabled).toBe(true);
    expect(result.token).toHaveLength(64); // 32 bytes hex
  });

  test("creates a list integration for sonarr", async () => {
    const result = await createOrUpdateIntegration("user-1", "sonarr");
    expect(result.type).toBe("list");
  });

  test("creates a list integration for radarr", async () => {
    const result = await createOrUpdateIntegration("user-1", "radarr");
    expect(result.type).toBe("list");
  });

  test("returns existing integration without duplicating", async () => {
    const first = await createOrUpdateIntegration("user-1", "jellyfin");
    const second = await createOrUpdateIntegration("user-1", "jellyfin");
    expect(second.id).toBe(first.id);
    expect(second.token).toBe(first.token);
  });

  test("updates enabled state on existing integration", async () => {
    await createOrUpdateIntegration("user-1", "jellyfin", true);
    const updated = await createOrUpdateIntegration("user-1", "jellyfin", false);
    expect(updated.enabled).toBe(false);
  });

  test("creates with enabled=false when specified", async () => {
    const result = await createOrUpdateIntegration("user-1", "jellyfin", false);
    expect(result.enabled).toBe(false);
  });
});

describe("listUserIntegrations", () => {
  test("returns empty list for user with no integrations", async () => {
    const result = await listUserIntegrations("user-1");
    expect(result.integrations).toHaveLength(0);
  });

  test("returns all integrations for user", async () => {
    await createOrUpdateIntegration("user-1", "jellyfin");
    await createOrUpdateIntegration("user-1", "emby");

    const result = await listUserIntegrations("user-1");
    expect(result.integrations).toHaveLength(2);
    const providers = result.integrations.map((i) => i.provider).sort();
    expect(providers).toEqual(["emby", "jellyfin"]);
  });

  test("does not return other users integrations", async () => {
    await insertUser("user-2");
    await createOrUpdateIntegration("user-1", "jellyfin");
    await createOrUpdateIntegration("user-2", "emby");

    const result = await listUserIntegrations("user-1");
    expect(result.integrations).toHaveLength(1);
    expect(result.integrations[0].provider).toBe("jellyfin");
  });

  test("serializes dates as ISO strings", async () => {
    await createOrUpdateIntegration("user-1", "jellyfin");
    const result = await listUserIntegrations("user-1");
    expect(result.integrations[0].createdAt).toMatch(ISO_DATE_RE);
  });
});

describe("deleteIntegration", () => {
  test("removes an integration", async () => {
    await createOrUpdateIntegration("user-1", "jellyfin");
    await deleteIntegration("user-1", "jellyfin");

    const result = await listUserIntegrations("user-1");
    expect(result.integrations).toHaveLength(0);
  });

  test("does not throw for nonexistent integration", async () => {
    await expect(deleteIntegration("user-1", "nonexistent")).resolves.not.toThrow();
  });
});

describe("findIntegrationByToken", () => {
  test("finds integration by token", async () => {
    const created = await createOrUpdateIntegration("user-1", "jellyfin");
    const found = await findIntegrationByToken(created.token);
    expect(found?.id).toBe(created.id);
  });

  test("returns undefined for invalid token", async () => {
    expect(await findIntegrationByToken("nonexistent")).toBeUndefined();
  });
});

describe("regenerateToken", () => {
  test("generates a new token for existing integration", async () => {
    const created = await createOrUpdateIntegration("user-1", "jellyfin");
    const [result] = await regenerateToken("user-1", "jellyfin");
    expect(result?.token).not.toBe(created.token);
    expect(result?.token).toHaveLength(64);
  });
});
