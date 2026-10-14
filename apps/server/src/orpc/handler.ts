import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";

import { createLogger } from "@sofa/logger";

import { router } from "./router";

const log = createLogger("orpc");

// 21.08: dashboard/library/title pages each fire 3-6 authenticated RPC calls
// on load, previously as separate HTTP requests — each independently
// re-running the `authed` middleware's `auth.api.getSession()`. Confirmed
// live (timing logs) that concurrent getSession() calls occasionally take
// 10-100+s and block the single JS thread for everyone, not just the caller.
// Batching collapses those into one request so getSession() runs once per
// page load instead of once per widget, removing the concurrency that
// triggers it — paired with the BatchLinkPlugin on the client.
export const handler = new RPCHandler(router, {
  plugins: [new BatchHandlerPlugin()],
  interceptors: [
    // 29.08: "Input validation failed: expected object, received undefined"
    // shows up occasionally (always in pairs, same millisecond — one failing
    // batch) but the log never said which procedure(s) it hit, so there was
    // no way to tell whether it's the same pair every time or random. This
    // logs the failing sub-request's own path so the next occurrence is
    // identifiable instead of anonymous.
    onError((error, options) => {
      log.error("oRPC error", { err: error, path: options?.request?.url?.pathname });
    }),
  ],
});
