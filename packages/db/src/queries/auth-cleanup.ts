import { lt } from "drizzle-orm";

import { db } from "../client";
import { session, verification } from "../schema";

export async function deleteExpiredSessions(): Promise<number> {
  const deleted = await db
    .delete(session)
    .where(lt(session.expiresAt, new Date()))
    .returning({ id: session.id });
  return deleted.length;
}

export async function deleteExpiredVerifications(): Promise<number> {
  const deleted = await db
    .delete(verification)
    .where(lt(verification.expiresAt, new Date()))
    .returning({ id: verification.id });
  return deleted.length;
}
