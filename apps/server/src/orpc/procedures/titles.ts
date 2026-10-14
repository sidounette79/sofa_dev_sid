import { ORPCError } from "@orpc/server";

import { AppErrorCode } from "@sofa/api/errors";
import { getRecommendationsForTitle } from "@sofa/core/discovery";
import { getPendingLibraryFolder } from "@sofa/core/media-requests";
import { getOrFetchTitle } from "@sofa/core/metadata";
import { getDisplayStatusesByTitleIds } from "@sofa/core/tracking";
import { getEmbyStatusByTitleIds, getRequestedAtByTitleIds } from "@sofa/db/queries/discovery";
import { deriveEmbyStatus } from "@sofa/db/queries/emby-library";

import { os } from "../context";
import { authed } from "../middleware";

export const get = os.titles.get.use(authed).handler(async ({ input, context }) => {
  const result = await getOrFetchTitle(input.id, context.user.id);
  if (!result)
    throw new ORPCError("NOT_FOUND", {
      message: "Title not found",
      data: { code: AppErrorCode.TITLE_NOT_FOUND },
    });
  return result;
});

export const similar = os.titles.similar.use(authed).handler(async ({ input, context }) => {
  const recs = await getRecommendationsForTitle(input.id);
  const userStatuses = await getDisplayStatusesByTitleIds(
    context.user.id,
    recs.map((r) => r.id),
  );
  // Sid's ask (25.08): rejecting a recommendation ("Mark as Dropped") should
  // actually remove it, not just flip its badge. Unlike discover.recommendations
  // (already excludes anything with a userTitleStatus row), this "similar to
  // this title" list is a fixed, user-agnostic set — filter dropped ones out
  // here at the procedure layer instead of touching the shared core query.
  const filteredRecs = recs.filter((r) => userStatuses[r.id] !== "dropped");

  // 26.08, Sid — full badge audit: "Recommended" never carried embyStatus or
  // requestedAt at all, so a title with no personal userStatus (the common
  // case here — recs are a fixed similar-titles list, not something the
  // user necessarily tracked) always fell through to "+" even when it was
  // already available or already requested household-wide. Same fields as
  // every other feed now.
  const titleIds = filteredRecs.map((r) => r.id);
  const [embyStatusMap, requestedAtMap] =
    titleIds.length > 0
      ? await Promise.all([getEmbyStatusByTitleIds(titleIds), getRequestedAtByTitleIds(titleIds)])
      : [{}, {}];
  const recommendations = filteredRecs.map((r) => {
    const emby = embyStatusMap[r.id];
    return {
      ...r,
      embyStatus: emby ? deriveEmbyStatus(emby.inEmbyLibrary, emby.embyItemId) : null,
      requestedAt: requestedAtMap[r.id] ?? null,
    };
  });

  return { recommendations, userStatuses };
});

export const pendingLibrary = os.titles.pendingLibrary.use(authed).handler(async ({ input }) => {
  const rootFolderPath = await getPendingLibraryFolder(input.id);
  return { rootFolderPath };
});
