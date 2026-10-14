import path from "node:path";

// ─── Paths ───────────────────────────────────────────────────

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");

// 08.10: Postgres connection string (e.g. postgres://user:pass@host:5432/db) -
// no longer a SQLite file path, see packages/db/src/client.ts.
export const DATABASE_URL =
  process.env.DATABASE_URL || "postgres://patounetv:patounetv@localhost:5432/patounetv";

export const CACHE_DIR = process.env.CACHE_DIR
  ? path.join(process.env.CACHE_DIR, "images")
  : path.join(DATA_DIR, "images");

export const BACKUP_DIR = path.join(DATA_DIR, "backups");

export const AVATAR_DIR = path.join(DATA_DIR, "avatars");

// ─── TMDB ────────────────────────────────────────────────────

export const TMDB_API_BASE_URL = process.env.TMDB_API_BASE_URL || "https://api.themoviedb.org/3";

export const TMDB_IMAGE_BASE_URL = process.env.TMDB_IMAGE_BASE_URL || "https://image.tmdb.org/t/p";

// ─── Watch providers ──────────────────────────────────────────

export const WATCH_REGION = process.env.WATCH_REGION || "US";

// ─── Emby (now playing) ─────────────────────────────────────────

export const EMBY_URL = process.env.EMBY_URL || null;

export const EMBY_API_KEY = process.env.EMBY_API_KEY || null;

// ─── Radarr / Sonarr (watchlist root-folder picker) ────────────
export const RADARR_URL = process.env.RADARR_URL || null;
export const RADARR_API_KEY = process.env.RADARR_API_KEY || null;
export const SONARR_URL = process.env.SONARR_URL || null;
export const SONARR_API_KEY = process.env.SONARR_API_KEY || null;
export const EMBY_PUBLIC_URL = process.env.EMBY_PUBLIC_URL || null;

// Emby user ID used as the admin/scan account for library-wide requests
// (Emby requires a userId for /Items and /Views endpoints).
export const EMBY_ADMIN_USER_ID = process.env.EMBY_ADMIN_USER_ID || null;

// Comma-separated list of Emby library (view) IDs to exclude from the
// Sofa library scan (e.g. IPTV, music, radio, ebooks, live TV folders).
export const EMBY_EXCLUDED_LIBRARY_IDS = (process.env.EMBY_EXCLUDED_LIBRARY_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// 25.08, Sid — one-way watch mirroring for shared-household ("CARBA")
// content: when WATCH_MIRROR_SOURCE_USER_ID watches a title filed under a
// CARBA-prefixed Emby library, the same watch is also logged for
// WATCH_MIRROR_TARGET_USER_ID (never the reverse). Explicitly scoped to this
// one directional pair, not a general linked-accounts feature — see
// packages/core/src/tracking.ts. Both unset (default) disables mirroring
// entirely.
export const WATCH_MIRROR_SOURCE_USER_ID = process.env.WATCH_MIRROR_SOURCE_USER_ID || null;
export const WATCH_MIRROR_TARGET_USER_ID = process.env.WATCH_MIRROR_TARGET_USER_ID || null;

// ─── Web Push (episode-release / status-change notifications) ─────

export const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || null;
export const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || null;
// Web Push spec requires a contact URI in the VAPID JWT ("subject") so a
// push service can reach out if a sender is misbehaving.
export const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@sidounette.ch";
