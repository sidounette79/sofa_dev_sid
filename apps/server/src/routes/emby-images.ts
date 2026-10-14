import { Hono } from "hono";

import { fetchEmbyImage } from "@sofa/core/emby";

const app = new Hono();

app.get("/:embyItemId", async (c) => {
  const embyItemId = c.req.param("embyItemId");
  const result = await fetchEmbyImage(embyItemId);

  if (!result) {
    return c.json({ error: "Not found" }, 404);
  }

  return new Response(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      // Emby posters rarely change once scanned — a day's caching is safe
      // and avoids re-fetching from Emby on every page load.
      "Cache-Control": "public, max-age=86400",
    },
  });
});

export default app;
