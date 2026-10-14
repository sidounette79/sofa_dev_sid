import { ORPCError } from "@orpc/server";

import { AppErrorCode } from "@sofa/api/errors";
import { fetchFullFilmography, getOrFetchPerson } from "@sofa/core/person";
import { getDisplayStatusesByTitleIds } from "@sofa/core/tracking";
import { getEmbyStatusByTitleIds, getRequestedAtByTitleIds } from "@sofa/db/queries/discovery";
import { deriveEmbyStatus } from "@sofa/db/queries/emby-library";

import { os } from "../context";
import { authed } from "../middleware";

export const get = os.people.get.use(authed).handler(async ({ input, context }) => {
  const person = await getOrFetchPerson(input.id);
  if (!person)
    throw new ORPCError("NOT_FOUND", {
      message: "Person not found",
      data: { code: AppErrorCode.PERSON_NOT_FOUND },
    });

  const allCredits = await fetchFullFilmography(person.id);

  const start = (input.page - 1) * input.limit;
  const pageCredits = allCredits.slice(start, start + input.limit);

  const titleIds = pageCredits.map((c) => c.titleId);
  const userStatuses = await getDisplayStatusesByTitleIds(context.user.id, titleIds);

  // 26.08, Sid — full badge audit: filmography grid never carried embyStatus
  // or requestedAt, so any credit without a personal userStatus (the common
  // case — most of a person's filmography isn't individually tracked)
  // always fell through to "+" even when already available or requested.
  const [embyStatusMap, requestedAtMap] =
    titleIds.length > 0
      ? await Promise.all([getEmbyStatusByTitleIds(titleIds), getRequestedAtByTitleIds(titleIds)])
      : [{}, {}];
  const filmography = pageCredits.map((c) => {
    const emby = embyStatusMap[c.titleId];
    return {
      ...c,
      embyStatus: emby ? deriveEmbyStatus(emby.inEmbyLibrary, emby.embyItemId) : null,
      requestedAt: requestedAtMap[c.titleId] ?? null,
    };
  });

  return {
    person,
    filmography,
    userStatuses,
    page: input.page,
    totalPages: Math.max(1, Math.ceil(allCredits.length / input.limit)),
    totalResults: allCredits.length,
  };
});
