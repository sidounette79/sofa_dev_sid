import { Hono } from "hono";

import { handleSingleEmbyItemDeleted, scanSingleEmbyItem } from "@sofa/core/emby-library";
import { findIntegrationByToken } from "@sofa/core/integrations";
import type { WebhookEvent } from "@sofa/core/webhooks";
import { parseEmbyPayload, parseJellyfinPayload, processWebhook } from "@sofa/core/webhooks";
import { createLogger } from "@sofa/logger";

const log = createLogger("webhooks");

const app = new Hono();

app.post("/:token", async (c) => {
  const token = c.req.param("token");

  // Look up connection by token — this IS the auth
  const connection = await findIntegrationByToken(token);

  if (!connection || !connection.enabled) {
    // Always return 200 to avoid retry storms from media servers
    return c.json({ ok: true });
  }

  // Only webhook-type integrations are handled here
  if (connection.type !== "webhook") {
    return c.json({ ok: true });
  }

  const provider = connection.provider as "jellyfin" | "emby";

  try {
    let event: WebhookEvent | null;
    if (provider === "emby") {
      // Emby's webhook plugin sends some events (confirmed: its "Send
      // Test Event" button, possibly others depending on plugin version)
      // as multipart/form-data with the actual JSON payload nested in a
      // "data" field, rather than a plain application/json body.
      const contentType = c.req.header("content-type") ?? "";
      let body: unknown;
      if (contentType.includes("multipart/form-data")) {
        const form = await c.req.parseBody();
        const dataField = form.data;
        if (typeof dataField !== "string") {
          throw new Error("Emby webhook multipart payload missing 'data' field");
        }
        body = JSON.parse(dataField);
      } else {
        const rawBody = await c.req.text();
        try {
          body = JSON.parse(rawBody);
        } catch (parseErr) {
          log.warn("Emby webhook payload failed to parse:", rawBody.slice(0, 4000));
          throw parseErr;
        }
      }

      // Real-time library scan: Emby fires a "library.new" event when a new
      // item is added, and "library.deleted" when one is removed. Both are
      // handled separately from playback events, and return early — no
      // watch event to process for either.
      const rawEvent = (body as Record<string, unknown>).Event;
      const item = (body as Record<string, unknown>).Item as
        | { Id?: string; Name?: string }
        | undefined;
      if (typeof rawEvent === "string" && /library\.new/i.test(rawEvent)) {
        // Logged (24.08) — real-time library-change events were previously
        // invisible in any persisted record (no logEvent call on this path,
        // unlike playback webhooks), making a missed/delayed event
        // unverifiable after the fact (confirmed case: "Lioness" only picked
        // up by the next periodic scan, cause never pinned down for lack of
        // a trace). log.info, not .debug, so it survives default log levels.
        log.info(`Emby library.new webhook: "${item?.Name ?? item?.Id ?? "unknown"}"`);
        if (item?.Id) {
          scanSingleEmbyItem(item.Id).catch((err) =>
            log.warn("Real-time Emby item scan failed:", err),
          );
        }
        return c.json({ ok: true });
      }
      if (typeof rawEvent === "string" && /library\.deleted/i.test(rawEvent)) {
        log.info(`Emby library.deleted webhook: "${item?.Name ?? item?.Id ?? "unknown"}"`);
        if (item?.Id) {
          handleSingleEmbyItemDeleted(item.Id).catch((err) =>
            log.warn("Real-time Emby item deletion handling failed:", err),
          );
        }
        return c.json({ ok: true });
      }

      event = parseEmbyPayload(body as Record<string, unknown>);
    } else {
      const body = await c.req.json();
      event = parseJellyfinPayload(body as Record<string, unknown>);
    }

    if (!event) {
      // Not a relevant event type — silently ignore
      return c.json({ ok: true });
    }

    await processWebhook(connection.id, connection.userId, provider, event);
  } catch (err) {
    // Swallow errors — never return non-200 to media servers
    log.warn("Webhook processing failed:", err);
  }

  return c.json({ ok: true });
});

export default app;
