import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { ORPCError } from "@orpc/server";

import { AppErrorCode } from "@sofa/api/errors";
import { auth } from "@sofa/auth/server";
import { AVATAR_DIR } from "@sofa/config";
import {
  createOrUpdateIntegration,
  deleteIntegration as coreDeleteIntegration,
  listUserIntegrations,
  regenerateToken as coreRegenerateToken,
  serializeIntegration,
  setEmbyUsername,
} from "@sofa/core/integrations";
import { listEmbyLibrariesForUser, setEmbyLibrariesForUser } from "@sofa/core/emby-library";
import { getUserPlatformIdList, updateUserPlatforms } from "@sofa/core/platforms";

import { os } from "../context";
import { authed } from "../middleware";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const updateName = os.account.updateName.use(authed).handler(async ({ input, context }) => {
  await auth.api.updateUser({
    body: { name: input.name },
    headers: context.headers,
  });
});

export const uploadAvatar = os.account.uploadAvatar
  .use(authed)
  .handler(async ({ input: file, context }) => {
    await mkdir(AVATAR_DIR, { recursive: true });

    const ext = MIME_TO_EXT[file.type] || "jpg";
    const filename = `${context.user.id}.${ext}`;
    const filePath = path.join(AVATAR_DIR, filename);
    const tmpPath = `${filePath}.tmp.${Date.now()}`;
    await writeFile(tmpPath, Buffer.from(await file.arrayBuffer()));
    await rename(tmpPath, filePath);

    const dirEntries = await readdir(AVATAR_DIR);
    const prefix = `${context.user.id}.`;
    for (const match of dirEntries) {
      if (match.startsWith(prefix) && match !== filename) {
        await unlink(path.join(AVATAR_DIR, match));
      }
    }

    const imageUrl = `/api/avatars/${context.user.id}?v=${Date.now()}`;
    await auth.api.updateUser({
      body: { image: imageUrl },
      headers: context.headers,
    });

    return { imageUrl };
  });

export const removeAvatar = os.account.removeAvatar.use(authed).handler(async ({ context }) => {
  const dirEntries = await readdir(AVATAR_DIR).catch(() => []);
  const prefix = `${context.user.id}.`;
  for (const match of dirEntries) {
    if (match.startsWith(prefix)) {
      await unlink(path.join(AVATAR_DIR, match));
    }
  }
  await auth.api.updateUser({
    body: { image: "" },
    headers: context.headers,
  });
});

export const platforms = os.account.platforms.use(authed).handler(async ({ context }) => {
  return { platformIds: await getUserPlatformIdList(context.user.id) };
});

export const updatePlatformsHandler = os.account.updatePlatforms
  .use(authed)
  .handler(async ({ input, context }) => {
    await updateUserPlatforms(context.user.id, input.platformIds);
  });

// ─── Integrations ─────────────────────────────────────────────

export const integrationsList = os.account.integrations.list
  .use(authed)
  .handler(({ context }) => {
    return listUserIntegrations(context.user.id);
  });

export const integrationsCreate = os.account.integrations.create
  .use(authed)
  .handler(({ input, context }) => {
    return createOrUpdateIntegration(context.user.id, input.provider, input.enabled);
  });

export const integrationsDelete = os.account.integrations.delete
  .use(authed)
  .handler(async ({ input, context }) => {
    await coreDeleteIntegration(context.user.id, input.provider);
  });

export const integrationsRegenerateToken = os.account.integrations.regenerateToken
  .use(authed)
  .handler(async ({ input, context }) => {
    const [row] = await coreRegenerateToken(context.user.id, input.provider);

    if (!row) {
      throw new ORPCError("NOT_FOUND", {
        message: "Integration not found",
        data: { code: AppErrorCode.INTEGRATION_NOT_FOUND },
      });
    }

    return serializeIntegration(row);
  });

export const integrationsUpdateEmbyUsername = os.account.integrations.updateEmbyUsername
  .use(authed)
  .handler(async ({ input, context }) => {
    const row = await setEmbyUsername(context.user.id, input.embyUsername);

    if (!row) {
      throw new ORPCError("NOT_FOUND", {
        message: "Integration not found",
        data: { code: AppErrorCode.INTEGRATION_NOT_FOUND },
      });
    }

    return row;
  });

export const integrationsListEmbyLibraries = os.account.integrations.listEmbyLibraries
  .use(authed)
  .handler(async ({ context }) => {
    return listEmbyLibrariesForUser(context.user.id);
  });

export const integrationsUpdateEmbyLibraries = os.account.integrations.updateEmbyLibraries
  .use(authed)
  .handler(async ({ input, context }) => {
    return setEmbyLibrariesForUser(context.user.id, input.libraryNames);
  });
