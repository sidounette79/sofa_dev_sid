import path from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createLogger } from "@sofa/logger";

import { db } from "./client";

const log = createLogger("db");

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(migrationsFolder = path.join(__dirname, "../drizzle")) {
  log.debug("Running database migrations...");
  await migrate(db, { migrationsFolder });
  log.debug("Database migrations complete");
}
