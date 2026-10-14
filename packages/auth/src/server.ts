import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { expo } from "@better-auth/expo";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { type BetterAuthOptions, betterAuth } from "better-auth/minimal";
import { admin, genericOAuth } from "better-auth/plugins";
import { v7 as uuidv7 } from "uuid";

import { claimInitialAdmin, isRegistrationOpen } from "@sofa/core/settings";
import { db } from "@sofa/db/client";
import { createLogger } from "@sofa/logger";

import { isOidcAutoRegisterEnabled, isOidcConfigured, isPasswordLoginDisabled } from "./config";

const authLog = createLogger("auth");

export const auth = betterAuth({
  // 21.08: was missing — better-auth then has to resolve baseURL
  // dynamically from request headers on every call instead of using this
  // fixed value directly. `BETTER_AUTH_URL` was already set in the
  // environment for this exact purpose but never actually wired in here.
  baseURL: process.env.BETTER_AUTH_URL,
  trustedOrigins: [
  "sofa://",
  ...(process.env.TRUSTED_ORIGINS?.split(",") ?? []),
],
  logger: {
    // Suppress unset secret/low entropy warnings during build
    disabled: process.env.NEXT_PHASE === "phase-production-build",
    level: "debug",
    log: (level, message, ...args) => {
      const fn = authLog[level as keyof typeof authLog];
      if (fn) fn(message, ...args);
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg",
  }),
  emailAndPassword: {
    enabled: !isPasswordLoginDisabled(),
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["oidc"],
    },
  },
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
      strategy: "jwt",
    },
  },
  plugins: [
    admin(),
    ...(isOidcConfigured()
      ? [
          genericOAuth({
            config: [
              {
                providerId: "oidc",
                clientId: process.env.OIDC_CLIENT_ID ?? "",
                clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
                discoveryUrl: `${process.env.OIDC_ISSUER_URL}/.well-known/openid-configuration`,
                scopes: ["openid", "email", "profile"],
                pkce: true,
                disableImplicitSignUp: !isOidcAutoRegisterEnabled(),
                mapProfileToUser: (profile) => ({
                  name: profile.name || profile.preferred_username || profile.email,
                }),
              },
            ],
          }),
        ]
      : []),
    expo(),
  ],
  // 08.10: `trustedProxies` removed - dead config in better-auth 1.5.6, not
  // in the types nor referenced anywhere in the compiled package. Was a
  // no-op even before this migration.
  advanced: {
    database: {
      generateId: () => uuidv7(),
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      // Block email/password sign-up when registration is closed.
      // This is endpoint-level so it doesn't affect OIDC user creation
      // (which is gated by the genericOAuth plugin's disableImplicitSignUp).
      if (ctx.path === "/sign-up/email") {
        const open = isRegistrationOpen();
        if (!open) {
          throw new APIError("FORBIDDEN", {
            message: "Registration is currently closed",
          });
        }
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          // Promote exactly one bootstrap user to admin, even if multiple
          // sign-ups race during the first-run window.
          claimInitialAdmin(user.id);
        },
      },
    },
  },
} satisfies BetterAuthOptions);

export type Session = typeof auth.$Infer.Session;
