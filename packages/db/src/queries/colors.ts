import { eq } from "drizzle-orm";

import { db } from "../client";
import { titles } from "../schema";

export async function updateTitleColorPalette(
  titleId: string,
  palette: string | null,
): Promise<void> {
  await db.update(titles).set({ colorPalette: palette }).where(eq(titles.id, titleId));
}
