import { type Context, Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";

import { CACHE_DIR } from "@sofa/config";
import { ensureBackupDir } from "@sofa/core/backup";
import { ensureImageDirs, imageCacheEnabled } from "@sofa/core/image-cache";
import { registerJobScheduleProvider } from "@sofa/core/system-health";
import { closeDatabase, isDatabaseAccessBlocked } from "@sofa/db/client";
import { runMigrations } from "@sofa/db/migrate";
import { recoverStaleImportJobs } from "@sofa/db/queries/imports";
import { seedPlatforms } from "@sofa/db/seed-platforms";
import { createLogger } from "@sofa/logger";

import { getJobSchedules, startJobs, stopJobs } from "./cron";
import { handler as rpcHandler } from "./orpc/handler";
import { openApiHandler } from "./orpc/openapi-handler";
import authRoutes from "./routes/auth";
import avatarsRoutes from "./routes/avatars";
import backupsRoutes from "./routes/backups";
import embyImagesRoutes from "./routes/emby-images";
import exportRoutes from "./routes/export";
import frenchOverviewRoutes from "./routes/french-overview";
import healthRoutes from "./routes/health";
import imagesRoutes from "./routes/images";
import jellyseerrCompatRoutes from "./routes/jellyseerr-compat";
import listsRoutes from "./routes/lists";
import moonfinSyncRoutes from "./routes/moonfin-sync";
import webhooksRoutes from "./routes/webhooks";

const log = createLogger("server");

// ─── Startup ──────────────────────────────────────────────────

// Ensure directories
if (imageCacheEnabled()) {
  await ensureImageDirs();
}
await ensureBackupDir();

// Run database migrations
await runMigrations();

// Seed streaming platforms (idempotent upsert)
await seedPlatforms();

// Recover import jobs left in running/pending state from a previous crash
const recoveredJobs = await recoverStaleImportJobs();
if (recoveredJobs > 0) {
  log.warn(`Recovered ${recoveredJobs} stale import job(s) from previous shutdown`);
}

// Wire up job schedule provider for system health
registerJobScheduleProvider(getJobSchedules);

// Start background jobs
await startJobs();

// 08.10, Patoune TV / Postgres migration: both the WAL-checkpoint worker and
// the title-episode-stats worker (separate Bun Worker threads, each with
// their own raw bun:sqlite connection) existed purely to work around
// bun:sqlite blocking the single JS thread - see project_patoune_tv_rebuild
// memory. Postgres is natively concurrent (a slow query only blocks its own
// caller), so neither workaround is needed anymore: WAL/vacuum housekeeping
// is Postgres's own job (autovacuum), and the episode-stats refresh is now
// a plain scheduled cron job (see cron.ts's "refreshTitleEpisodeStats").

// 21.08: diagnosing a still-unexplained freeze — the single JS thread
// occasionally appears pegged for 15-100+s during a request (confirmed via
// /proc: real user CPU time, not I/O wait), but every targeted fix so far
// (WAL tuning, oRPC batching, session-check coalescing, disabling the JIT)
// made no difference. This tick fires every 500ms via setInterval; if the
// event loop is genuinely and fully stalled (not just the auth/DB code
// path specifically), this will be late by the same amount, proving whether
// it's a total event-loop stall or something narrower that only *looks*
// like one from the RPC timing alone.
let lastTick = Date.now();
setInterval(() => {
  const now = Date.now();
  const gap = now - lastTick;
  lastTick = now;
  if (gap > 1000) {
    log.warn(`Event loop heartbeat delayed by ${gap}ms (expected ~500ms)`);
  }
}, 500);

// ─── App ──────────────────────────────────────────────────────

const app = new Hono();

// CORS — allow the web app's origin
app.use(
  "*",
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:3000",
    credentials: true,
    maxAge: 86400,
  }),
);

app.use("*", async (c, next) => {
  if (isDatabaseAccessBlocked() && c.req.path !== "/api/health") {
    return c.json({ error: "Service unavailable during database restore" }, 503);
  }
  await next();
});

// Non-RPC routes
app.route("/api/health", healthRoutes);
app.route("/api/auth", authRoutes);
app.route("/api/avatars", avatarsRoutes);
app.route("/api/backup", backupsRoutes);
app.route("/api/export", exportRoutes);
app.route("/api/webhooks", webhooksRoutes);
app.route("/api/lists", listsRoutes);
app.route("/api/moonfin-sync", moonfinSyncRoutes);
// 28.09, real Emby log evidence: Moonbase actually calls
// {seerrUrl}/api/v1/<endpoint> (real Jellyseerr's own convention - every
// endpoint in this compat layer lives under /api/v1, not bare) - mounted
// twice so a stray bare call still resolves instead of 404ing.
app.route("/api/jellyseerr/api/v1", jellyseerrCompatRoutes);
app.route("/api/jellyseerr", jellyseerrCompatRoutes);
app.route("/api/french-overview", frenchOverviewRoutes);

// Cached images — serve from disk (fast path), fall back to TMDB fetch on miss
if (imageCacheEnabled()) {
  app.use(
    "/images/*",
    serveStatic({
      root: CACHE_DIR,
      rewriteRequestPath: (path) => path.replace("/images", ""),
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
}
app.route("/images", imagesRoutes);
app.route("/emby-images", embyImagesRoutes);

// oRPC RPC handler
// 21.08: investigating a recurring freeze (CPU pegged ~100%, confirmed via
// /proc to be entirely on the main JS thread — real synchronous compute, not
// I/O) that self-resolves after several minutes and has hit unrelated pages
// (library list, a title detail page) with no reproducible cause found via
// direct function-level testing. Logging every RPC call's route + duration
// here so the next occurrence is caught with real evidence (which procedure
// was in flight, not a guess) instead of another after-the-fact investigation.
const SLOW_RPC_THRESHOLD_MS = 300;
app.all("/rpc/*", async (c) => {
  const start = performance.now();
  const { response } = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context: { headers: c.req.raw.headers },
  });
  const durationMs = Math.round(performance.now() - start);
  if (durationMs > SLOW_RPC_THRESHOLD_MS) {
    log.warn(`Slow RPC call: ${c.req.method} ${c.req.path} took ${durationMs}ms`);
  }
  return response ?? c.text("Not found", 404);
});

// oRPC OpenAPI handler + Scalar docs
const handleOpenApi = async (c: Context) => {
  const { response } = await openApiHandler.handle(c.req.raw, {
    prefix: "/api/v1",
    context: { headers: c.req.raw.headers },
  });
  return response ?? c.text("Not found", 404);
};

app.all("/api/v1", handleOpenApi);
app.all("/api/v1/*", handleOpenApi);

// ─── SPA static serving (production) ─────────────────────────

if (process.env.NODE_ENV === "production") {
  const { resolve } = await import("node:path");
  const spaDir = resolve(import.meta.dir, "../../../apps/web/dist");

  // Hashed assets — immutable cache
  app.use(
    "/assets/*",
    serveStatic({
      root: spaDir,
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  );
  // Return 404 for missing /assets/* (stale chunks after deploy) instead of SPA fallback
  app.all("/assets/*", (c) => c.text("Not found", 404));
  // Other static files (icons, manifest, etc.)
  // 08.10, Sid — real bug found live (PWA on mobile, closing+reopening the
  // app never picked up a new deploy, even after 12 tries): index.html had
  // no explicit Cache-Control, so it fell back to the browser's own
  // heuristics — fine for a normal tab, but installed PWAs tend to cache the
  // entry HTML far more aggressively on reopen. It then kept referencing
  // hashed /assets/* chunks from the PREVIOUS deploy, which 404 (see above)
  // instead of falling back — a silent white-screen/crash with no server-
  // side trace, exactly what she was seeing. index.html must never be
  // cached; only the content-hashed chunks it points to are safe to cache
  // forever. This single middleware now handles BOTH cases (a real static
  // file like an icon, or Hono's own isDir->DEFAULT_DOCUMENT fallback
  // serving index.html for "/") since the second one was silently
  // short-circuiting a separate app.get("*", ...) route placed after it —
  // onFound never got a chance to run there.
  app.use(
    "*",
    serveStatic({
      root: spaDir,
      onFound: (path, c) => {
        if (path.endsWith("index.html")) {
          c.header("Cache-Control", "no-store");
        }
        // 14.10, Sid: same class of bug as index.html above, for sw.js —
        // an installed PWA that caches the service worker script itself
        // can go a long time without ever re-fetching it to notice a new
        // version exists, especially if the window is only ever
        // suspended/resumed and never truly reloaded.
        if (path.endsWith("sw.js")) {
          c.header("Cache-Control", "no-store");
        }
      },
    }),
  );
  // SPA fallback — unmatched routes (e.g. /titles/abc) have no file on disk,
  // so the middleware above calls next() and falls through to here.
  app.get(
    "*",
    serveStatic({
      root: spaDir,
      path: "/index.html",
      onFound: (_path, c) => {
        c.header("Cache-Control", "no-store");
      },
    }),
  );
}

// ─── Graceful shutdown ────────────────────────────────────────

const shutdown = () => {
  log.info("Stopping scheduler...");
  stopJobs();
  log.info("Closing database...");
  closeDatabase();
  log.info("Clean shutdown complete");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

const port = Number(process.env.PORT || process.env.API_PORT || 3001);
const server = Bun.serve({
  port,
  fetch: app.fetch,
});

log.info(
  `🐾 Patoune TV${process.env.APP_VERSION ? ` v${process.env.APP_VERSION}` : ""}: Now playing at ${server.url.origin}`,
  {
    address: server.hostname,
    port: server.port,
  },
);

export default server;
