import { Hono } from "hono";

import { verifyEmbyUserToken } from "@sofa/core/emby";
import { getMoonfinSyncSettings, setMoonfinSyncSettings } from "@sofa/db/queries/moonfin-sync";
import { createLogger } from "@sofa/logger";

const log = createLogger("moonfin-sync");

const app = new Hono();

// 30.09, Sid — Moonfin's own settings-sync channel, bypassing Moonbase
// entirely (it silently drops the custom fields Moonfin needs - IPTV
// providers, pinned libraries). Auth delegates to Emby: the caller sends
// whatever access token it's already using for every other Emby call, this
// verifies it against Emby's own /Users/Me (see verifyEmbyUserToken) and
// scopes the stored blob to that real, server-confirmed user id - no
// separate secret to mint, expose, or have her copy into Moonfin by hand.
async function requireEmbyUserId(c: {
  req: { header: (name: string) => string | undefined };
}): Promise<string | null> {
  const token = c.req.header("X-Emby-Token");
  if (!token) return null;
  return verifyEmbyUserToken(token);
}

app.get("/settings", async (c) => {
  const userId = await requireEmbyUserId(c);
  if (!userId) return c.json({ error: "Invalid or missing Emby token" }, 401);

  const data = await getMoonfinSyncSettings(userId);
  return c.json({ data });
});

app.put("/settings", async (c) => {
  const userId = await requireEmbyUserId(c);
  if (!userId) return c.json({ error: "Invalid or missing Emby token" }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const data = (body as { data?: unknown })?.data;
  if (typeof data !== "string") {
    return c.json({ error: "Expected a 'data' string field" }, 400);
  }

  try {
    await setMoonfinSyncSettings(userId, data);
  } catch (err) {
    log.warn("Failed to store settings:", err);
    return c.json({ error: "Failed to store settings" }, 500);
  }

  return c.json({ ok: true });
});

export default app;
