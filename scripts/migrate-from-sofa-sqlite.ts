/**
 * One-time data migration: Sofa's SQLite database → Patoune TV's Postgres
 * database. Strictly a COPY — opens the source SQLite file read-only and
 * never writes to it, so Sofa itself is completely unaffected and can keep
 * running normally throughout and after this script. Safe to re-run: every
 * insert uses onConflictDoNothing() keyed by primary key, so a second run
 * just skips rows already migrated.
 *
 * Usage: node --experimental-strip-types scripts/migrate-from-sofa-sqlite.ts <path-to-sofa-sqlite.db>
 *
 * Requires DATABASE_URL (Patoune TV's Postgres) to be set in the environment.
 */
import { Database } from "bun:sqlite";

import { getTableColumns } from "drizzle-orm";

import { db } from "../packages/db/src/client";
import * as schema from "../packages/db/src/schema";

const sqlitePath = process.argv[2];
if (!sqlitePath) {
  console.error("Usage: migrate-from-sofa-sqlite.ts <path-to-sofa-sqlite.db>");
  process.exit(1);
}

// readonly: true at the OS/driver level — this script cannot write to the
// source file even if a bug were to try.
const sqlite = new Database(sqlitePath, { readonly: true });

// Order matters: every table here must come after every table it
// references (FK columns), so onConflictDoNothing() never collides with
// referential integrity instead of a real duplicate-key no-op. Tables
// deliberately NOT migrated: cronRuns (job-run history, no lasting value),
// titleEpisodeStats (derived cache, regenerated fresh by its own cron job),
// and importJobs (stale job state from the old instance, not worth
// carrying forward). Book-tracking tables (authorPhotoCache,
// watchedAuthors, trackedReleases, catalogOverrides, catalogRejections)
// don't exist in the new schema at all — Grimmory owns books now.
const TABLES_IN_ORDER = [
  schema.user,
  schema.session,
  schema.account,
  schema.verification,
  schema.genres,
  schema.platforms,
  schema.persons,
  schema.titles,
  schema.titleGenres,
  schema.seasons,
  schema.episodes,
  schema.pushSubscriptions,
  schema.userTitleStatus,
  schema.userMovieWatches,
  schema.userEpisodeWatches,
  schema.userRatings,
  schema.platformTmdbIds,
  schema.titleAvailability,
  schema.userPlatforms,
  schema.userEmbyLibraries,
  schema.titleRecommendations,
  schema.titleCast,
  schema.personFilmography,
  schema.integrations,
  schema.integrationEvents,
  schema.userRequestDefaults,
  schema.userPlaybackDevices,
  schema.userDismissedPlaybackDevices,
  schema.unresolvedSeriesRequests,
  schema.appSettings,
  schema.moonfinSyncSettings,
] as const;

const BATCH_SIZE = 500;

function transformRow(
  row: Record<string, unknown>,
  columnTypes: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const type = columnTypes[key];
    if (value === null || value === undefined) {
      out[key] = null;
    } else if (type === "PgBoolean") {
      out[key] = Boolean(value);
    } else if (type === "PgTimestamp") {
      out[key] = new Date(Number(value) * 1000);
    } else {
      out[key] = value;
    }
  }
  return out;
}

async function migrateTable(table: (typeof TABLES_IN_ORDER)[number]): Promise<void> {
  // @ts-expect-error — drizzle-orm's internal symbol, read for the raw SQL table name
  const tableName = table[Symbol.for("drizzle:Name")] as string;
  const columns = getTableColumns(table);
  const columnTypes: Record<string, string> = {};
  for (const [key, col] of Object.entries(columns)) {
    columnTypes[key] = col.columnType;
  }

  let exists: { name: string } | undefined;
  try {
    exists = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(tableName) as { name: string } | undefined;
  } catch {
    exists = undefined;
  }
  if (!exists) {
    console.log(`  ${tableName}: not present in source DB, skipping`);
    return;
  }

  const rows = sqlite.prepare(`SELECT * FROM "${tableName}"`).all() as Record<string, unknown>[];
  if (rows.length === 0) {
    console.log(`  ${tableName}: 0 rows`);
    return;
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows
      .slice(i, i + BATCH_SIZE)
      .map((row) => transformRow(row, columnTypes));
    const result = await db
      .insert(table)
      .values(batch)
      .onConflictDoNothing()
      .returning();
    inserted += result.length;
  }
  console.log(`  ${tableName}: ${inserted}/${rows.length} rows inserted (rest already migrated)`);
}

async function main() {
  console.log(`Migrating from ${sqlitePath} (read-only) into Patoune TV's Postgres...\n`);
  for (const table of TABLES_IN_ORDER) {
    await migrateTable(table);
  }
  console.log("\nDone. Sofa's SQLite database was never modified.");
  sqlite.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  sqlite.close();
  process.exit(1);
});
