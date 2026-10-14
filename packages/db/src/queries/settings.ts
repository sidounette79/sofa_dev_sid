import { asc, count, eq, inArray } from "drizzle-orm";

import { db } from "../client";
import { appSettings, user } from "../schema";

const INITIAL_ADMIN_KEY = "initialAdminAssigned";

export async function getSettingValue(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function getSettingValues(keys: string[]): Promise<Record<string, string | null>> {
  if (keys.length === 0) return {};
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, keys));
  const result: Record<string, string | null> = {};
  for (const key of keys) result[key] = null;
  for (const row of rows) result[row.key] = row.value;
  return result;
}

export async function upsertSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value } });
}

export async function getUserCount(): Promise<number> {
  const [result] = await db.select({ count: count() }).from(user);
  return result?.count ?? 0;
}

export async function claimInitialAdmin(userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [firstUser] = await tx
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt), asc(user.id))
      .limit(1);
    if (!firstUser || firstUser.id !== userId) {
      return false;
    }

    const [lock] = await tx
      .insert(appSettings)
      .values({ key: INITIAL_ADMIN_KEY, value: userId })
      .onConflictDoNothing()
      .returning({ key: appSettings.key });
    if (!lock) {
      return false;
    }

    await tx.update(user).set({ role: "admin" }).where(eq(user.id, userId));
    await tx
      .insert(appSettings)
      .values({ key: "registrationOpen", value: "false" })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value: "false" },
      });

    return true;
  });
}
