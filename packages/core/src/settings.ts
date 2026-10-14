import {
  claimInitialAdmin as queryClaimInitialAdmin,
  getSettingValue,
  getSettingValues,
  getUserCount as queryGetUserCount,
  upsertSetting,
} from "@sofa/db/queries/settings";
import { v7 as uuidv7 } from "uuid";

export function getSetting(key: string): Promise<string | null> {
  return getSettingValue(key);
}

export function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  return getSettingValues(keys);
}

export function setSetting(key: string, value: string): Promise<void> {
  return upsertSetting(key, value);
}

export function getUserCount(): Promise<number> {
  return queryGetUserCount();
}

export function claimInitialAdmin(userId: string): Promise<boolean> {
  return queryClaimInitialAdmin(userId);
}

export async function getInstanceId(): Promise<string> {
  const existing = await getSetting("instanceId");
  if (existing) return existing;
  const id = uuidv7();
  await setSetting("instanceId", id);
  return id;
}

export async function isRegistrationOpen(): Promise<boolean> {
  const userCount = await getUserCount();
  if (userCount === 0) return true;

  const setting = await getSetting("registrationOpen");
  return setting === "true";
}
