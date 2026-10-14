// 14.10, Sid: real crash reported live on phone/tablet (request dialog,
// swipe-back) that never reproduced on desktop and left zero trace in the
// oRPC error logger - the exception was a pure client-side render error,
// invisible server-side. This gives the web app somewhere to report what
// it actually caught, so the next occurrence shows up in these logs
// instead of needing a screenshot of mobile DevTools (impractical on
// phone/TV). Deliberately unauthenticated - a broken session is exactly
// the kind of state this needs to still be able to report from.
import { Hono } from "hono";

import { createLogger } from "@sofa/logger";

const log = createLogger("client-error");

const app = new Hono();

app.post("/", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false }, 400);
  }

  const { message, stack, componentStack, url, userAgent } = (body ?? {}) as Record<
    string,
    unknown
  >;

  log.error("Client-side render error", {
    message: typeof message === "string" ? message.slice(0, 2000) : null,
    stack: typeof stack === "string" ? stack.slice(0, 4000) : null,
    componentStack: typeof componentStack === "string" ? componentStack.slice(0, 2000) : null,
    url: typeof url === "string" ? url.slice(0, 500) : null,
    userAgent: typeof userAgent === "string" ? userAgent.slice(0, 300) : null,
  });

  return c.json({ ok: true });
});

export default app;
