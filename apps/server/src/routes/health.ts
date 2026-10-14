import { Hono } from "hono";

import { getInstanceId } from "@sofa/core/settings";
import { createLogger } from "@sofa/logger";

const log = createLogger("health");

const app = new Hono();

app.get("/", async (c) => {
  try {
    return c.json({ status: "healthy", instanceId: await getInstanceId() }, 200);
  } catch (err) {
    log.error("Health check failed:", err);
    return c.json({ status: "unhealthy" }, 503);
  }
});

export default app;
