import { eq } from "drizzle-orm";

import { db } from "../client";
import { userRequestDefaults } from "../schema";

export function getUserRequestDefaults(userId: string) {
  return db
    .select()
    .from(userRequestDefaults)
    .where(eq(userRequestDefaults.userId, userId))
    ;
}

export function listAllUserRequestDefaults() {
  return db.select().from(userRequestDefaults);
}

/** Upsert — the admin settings screen always writes the full set at once. */
export function setUserRequestDefaults(input: {
  userId: string;
  radarrRootFolder: string | null;
  radarrQualityProfileId: number | null;
  sonarrRootFolder: string | null;
  sonarrQualityProfileId: number | null;
}) {
  return db
    .insert(userRequestDefaults)
    .values({ ...input, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: userRequestDefaults.userId,
      set: {
        radarrRootFolder: input.radarrRootFolder,
        radarrQualityProfileId: input.radarrQualityProfileId,
        sonarrRootFolder: input.sonarrRootFolder,
        sonarrQualityProfileId: input.sonarrQualityProfileId,
        updatedAt: new Date(),
      },
    })
    .returning()
    ;
}
