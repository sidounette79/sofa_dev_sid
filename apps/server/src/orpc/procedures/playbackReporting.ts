import { getPlaybackActivity, listUsersWithActivity } from "@sofa/core/playback-reporting";

import { os } from "../context";
import { admin } from "../middleware";

export const activity = os.playbackReporting.activity.use(admin).handler(({ input }) => {
  return getPlaybackActivity(input);
});

export const users = os.playbackReporting.users.use(admin).handler(async () => {
  return { items: await listUsersWithActivity() };
});
