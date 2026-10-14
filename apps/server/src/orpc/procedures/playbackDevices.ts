import { ORPCError } from "@orpc/server";

import { AppErrorCode } from "@sofa/api/errors";
import {
  dismissDevice,
  listAvailableDevices,
  listFavoriteDevices,
  playOnDevice,
  PlaybackDeviceError,
  setFavoriteDevices,
} from "@sofa/core/playback-devices";

import { os } from "../context";
import { authed } from "../middleware";

export const listAvailable = os.playbackDevices.listAvailable
  .use(authed)
  .handler(async ({ context }) => {
    return { items: await listAvailableDevices(context.user.id) };
  });

export const listFavorites = os.playbackDevices.listFavorites
  .use(authed)
  .handler(async ({ context }) => {
    return { items: await listFavoriteDevices(context.user.id) };
  });

export const setFavorites = os.playbackDevices.setFavorites
  .use(authed)
  .handler(async ({ input, context }) => {
    await setFavoriteDevices(context.user.id, input.devices);
  });

export const dismiss = os.playbackDevices.dismiss
  .use(authed)
  .handler(async ({ input, context }) => {
    await dismissDevice(context.user.id, input.embyDeviceId);
  });

export const playOn = os.playbackDevices.playOn
  .use(authed)
  .handler(async ({ input, context }) => {
    try {
      await playOnDevice(
        context.user.id,
        input.embyDeviceId,
        input.episodeId ? { episodeId: input.episodeId } : { titleId: input.titleId! },
      );
    } catch (err) {
      if (err instanceof PlaybackDeviceError) {
        throw new ORPCError("BAD_REQUEST", {
          message: err.message,
          data: { code: AppErrorCode.PLAYBACK_DEVICE_ERROR },
        });
      }
      throw err;
    }
  });
