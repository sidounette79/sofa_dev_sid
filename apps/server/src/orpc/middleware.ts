import { oo } from "@orpc/openapi";
import { os as baseOs, ORPCError } from "@orpc/server";

import { auth } from "@sofa/auth/server";
import { createLogger } from "@sofa/logger";

const log = createLogger("auth-middleware");
const base = baseOs.$context<{ headers: Headers }>();

// 21.08: oRPC batching (see ./handler.ts) collapses a page's N authenticated
// calls into one HTTP request, but the batch handler still runs each call's
// middleware — including this one's `auth.api.getSession()` — concurrently
// via Promise.all internally. Confirmed live: within a single `__batch__`
// request, several concurrent getSession() calls still each took 15-25s
// before dropping to ~400ms once the pack cleared — the contention is
// between concurrent getSession() invocations themselves, not the HTTP
// layer. Single-flight fix: concurrent calls carrying the same cookie
// share one in-flight getSession() promise instead of each starting their
// own, so only one ever actually runs at a time per request burst.
const inFlightSessions = new Map<string, ReturnType<typeof auth.api.getSession>>();

function getSessionCoalesced(headers: Headers) {
  const key = headers.get("cookie") ?? "";
  const existing = inFlightSessions.get(key);
  if (existing) return existing;

  const promise = auth.api.getSession({ headers }).finally(() => {
    inFlightSessions.delete(key);
  });
  inFlightSessions.set(key, promise);
  return promise;
}

export const authed = oo.spec(
  base.middleware(async ({ context, next }) => {
    let sessionData;
    const sessionStart = performance.now();
    try {
      sessionData = await getSessionCoalesced(context.headers);
    } catch (err) {
      console.error("DEBUG getSession threw:", err);
      throw new ORPCError("UNAUTHORIZED");
    }
    const sessionMs = Math.round(performance.now() - sessionStart);
    if (sessionMs > 200) {
      log.warn(`Slow auth.api.getSession(): ${sessionMs}ms`);
    }
    if (!sessionData?.session || !sessionData?.user) {
      console.error("DEBUG getSession returned empty. Cookie header:", context.headers.get("cookie"));
      throw new ORPCError("UNAUTHORIZED");
    }
    return next({
      context: {
        user: sessionData.user,
        session: sessionData.session,
      },
    });
  }),
  { security: [{ session: [] }] },
);

export const admin = oo.spec(
  base.middleware(async ({ context, next }) => {
    const sessionData = await getSessionCoalesced(context.headers);
    if (!sessionData?.session || !sessionData?.user) {
      throw new ORPCError("UNAUTHORIZED");
    }
    if (sessionData.user.role !== "admin") {
      throw new ORPCError("FORBIDDEN");
    }
    return next({
      context: {
        user: sessionData.user,
        session: sessionData.session,
      },
    });
  }),
  { security: [{ session: [] }] },
);
