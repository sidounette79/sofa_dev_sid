import { msg } from "@lingui/core/macro";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { contract } from "@sofa/api/contract";
import { i18n } from "@sofa/i18n";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 10 * 60_000,
      refetchOnWindowFocus: false,
    },
  },
  queryCache: new QueryCache({
    onError: (_error, query) => {
      toast.error(i18n._(msg`Something went wrong…`), {
        action: {
          label: i18n._(msg`Retry`),
          onClick: () => query.invalidate(),
        },
      });
    },
  }),
});

export const link = new RPCLink({
  url: `${window.location.origin}/rpc`,
  fetch: (input, init) => fetch(input, { ...init, credentials: "include" }),
  // 21.08: pages fire several authenticated calls on load (dashboard: 6,
  // title page: 3) — batching them into one HTTP request means the server's
  // auth check runs once per page load instead of once per call. See
  // apps/server/src/orpc/handler.ts for why this matters (concurrent
  // getSession() calls confirmed to occasionally take 10-100+s).
  plugins: [
    new BatchLinkPlugin({
      groups: [{ condition: () => true, context: {} }],
    }),
  ],
});

export const client: ContractRouterClient<typeof contract> = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
