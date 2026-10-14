import { eq } from "drizzle-orm";

import { db } from "../client";
import { moonfinSyncSettings } from "../schema";

export async function getMoonfinSyncSettings(embyUserId: string): Promise<string | null> {
  const [row] = await db
    .select({ data: moonfinSyncSettings.data })
    .from(moonfinSyncSettings)
    .where(eq(moonfinSyncSettings.embyUserId, embyUserId));
  return row?.data ?? null;
}

export async function setMoonfinSyncSettings(embyUserId: string, data: string): Promise<void> {
  await db
    .insert(moonfinSyncSettings)
    .values({ embyUserId, data, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: moonfinSyncSettings.embyUserId,
      set: { data, updatedAt: new Date() },
    });
}
