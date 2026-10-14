import { beforeEach, describe, expect, test } from "vitest";

import { user } from "@sofa/db/schema";
import { clearAllTables, eq, insertUser, testDb } from "@sofa/test/db";

import {
  claimInitialAdmin,
  getSetting,
  getUserCount,
  isRegistrationOpen,
  setSetting,
} from "../src/settings";

beforeEach(async () => {
  await clearAllTables();
});

// ── getSetting / setSetting ─────────────────────────────────────────

describe("getSetting / setSetting", () => {
  test("returns null for missing key", async () => {
    expect(await getSetting("nonexistent")).toBeNull();
  });

  test("stores and retrieves a value", async () => {
    await setSetting("theme", "dark");
    expect(await getSetting("theme")).toBe("dark");
  });

  test("upserts: overwrites existing value", async () => {
    await setSetting("theme", "dark");
    await setSetting("theme", "light");
    expect(await getSetting("theme")).toBe("light");
  });
});

// ── getUserCount ────────────────────────────────────────────────────

describe("getUserCount", () => {
  test("returns 0 when no users", async () => {
    expect(await getUserCount()).toBe(0);
  });

  test("returns correct count", async () => {
    await insertUser("user-1");
    await insertUser("user-2");
    expect(await getUserCount()).toBe(2);
  });
});

// ── isRegistrationOpen ──────────────────────────────────────────────

describe("isRegistrationOpen", () => {
  test("returns true when no users exist (first-run)", async () => {
    expect(await isRegistrationOpen()).toBe(true);
  });

  test("returns false when users exist and setting is not set", async () => {
    await insertUser();
    expect(await isRegistrationOpen()).toBe(false);
  });

  test("returns true when users exist and setting is 'true'", async () => {
    await insertUser();
    await setSetting("registrationOpen", "true");
    expect(await isRegistrationOpen()).toBe(true);
  });

  test("returns false when users exist and setting is 'false'", async () => {
    await insertUser();
    await setSetting("registrationOpen", "false");
    expect(await isRegistrationOpen()).toBe(false);
  });
});

describe("claimInitialAdmin", () => {
  test("promotes the earliest user to admin and closes registration", async () => {
    await insertUser("user-1");
    await insertUser("user-2");

    expect(await claimInitialAdmin("user-2")).toBe(false);
    expect(await claimInitialAdmin("user-1")).toBe(true);
    expect(await claimInitialAdmin("user-1")).toBe(false);

    const [firstUser] = await testDb.select().from(user).where(eq(user.id, "user-1"));
    const [secondUser] = await testDb.select().from(user).where(eq(user.id, "user-2"));

    expect(firstUser?.role).toBe("admin");
    expect(secondUser?.role).toBe("user");
    expect(await getSetting("registrationOpen")).toBe("false");
  });
});
