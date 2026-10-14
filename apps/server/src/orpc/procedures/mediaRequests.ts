import { ORPCError } from "@orpc/server";

import { AppErrorCode } from "@sofa/api/errors";
import {
  getRequestOptions,
  getUserDefaults,
  listUserDefaults,
  listUnresolvedSeriesRequestTitles,
  MediaRequestError,
  NoTvdbIdError,
  requestMovie as requestMovieFn,
  requestSeries as requestSeriesFn,
  setUserDefaults,
  TitleNotFoundError,
} from "@sofa/core/media-requests";

import { tmdbImageUrl } from "@sofa/tmdb/image";

import { os } from "../context";
import { admin, authed } from "../middleware";

export const getOptions = os.mediaRequests.getOptions.use(authed).handler(async () => {
  return getRequestOptions();
});

export const listUserDefaultsHandler = os.mediaRequests.listUserDefaults
  .use(admin)
  .handler(async () => {
    return { items: await listUserDefaults() };
  });

export const getMyDefaults = os.mediaRequests.getMyDefaults
  .use(authed)
  .handler(({ context }) => {
    return getUserDefaults(context.user.id);
  });

export const setUserDefaultsHandler = os.mediaRequests.setUserDefaults
  .use(admin)
  .handler(async ({ input }) => {
    const { userId, ...defaults } = input;
    await setUserDefaults(userId, defaults);
  });

export const requestMovie = os.mediaRequests.requestMovie
  .use(authed)
  .handler(async ({ input, context }) => {
    try {
      await requestMovieFn(context.user.id, context.user.name, input.id, {
        rootFolderPath: input.rootFolderPath,
        qualityProfileId: input.qualityProfileId,
      });
    } catch (err) {
      if (err instanceof TitleNotFoundError) {
        throw new ORPCError("NOT_FOUND", {
          message: err.message,
          data: { code: AppErrorCode.TITLE_NOT_FOUND },
        });
      }
      if (err instanceof MediaRequestError) {
        throw new ORPCError("BAD_REQUEST", { message: err.message });
      }
      throw err;
    }
  });

export const requestSeries = os.mediaRequests.requestSeries
  .use(authed)
  .handler(async ({ input, context }) => {
    try {
      await requestSeriesFn(context.user.id, context.user.name, input.id, {
        rootFolderPath: input.rootFolderPath,
        qualityProfileId: input.qualityProfileId,
        seasonNumbers: input.seasonNumbers,
      });
    } catch (err) {
      if (err instanceof TitleNotFoundError) {
        throw new ORPCError("NOT_FOUND", {
          message: err.message,
          data: { code: AppErrorCode.TITLE_NOT_FOUND },
        });
      }
      if (err instanceof NoTvdbIdError) {
        throw new ORPCError("BAD_REQUEST", {
          message: err.message,
          data: { code: AppErrorCode.NO_TVDB_ID },
        });
      }
      if (err instanceof MediaRequestError) {
        throw new ORPCError("BAD_REQUEST", { message: err.message });
      }
      throw err;
    }
  });

export const listUnresolvedSeriesRequests = os.mediaRequests.listUnresolvedSeriesRequests
  .use(authed)
  .handler(async ({ context }) => {
    // 06.09, Sid: poster showed up blank here (but fine on the title page)
    // — raw TMDB relative path (e.g. "/xyz.jpg") was never run through
    // tmdbImageUrl, unlike every other place a poster gets sent to the
    // client (library.ts, discover.ts...).
    const items = await listUnresolvedSeriesRequestTitles(context.user.id);
    return {
      items: items.map((item) => ({
        ...item,
        posterPath: tmdbImageUrl(item.posterPath, "posters"),
      })),
    };
  });
