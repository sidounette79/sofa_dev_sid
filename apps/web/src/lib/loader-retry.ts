import { ORPCError } from "@orpc/client";

// 29.08: intermittent "Input validation failed: expected object, received
// undefined" BAD_REQUEST errors — always arriving in a same-millisecond
// pair, i.e. one failing batched RPC request — occasionally take down a
// route loader (ensureQueryData/ensureInfiniteQueryData reject straight to
// the router's errorComponent). Manually clicking the error screen's retry
// always succeeds immediately after, which means the underlying condition
// clears fast. This narrowly targets that exact error shape and retries the
// loader task once before giving up, instead of showing the crash screen for
// something that's gone a moment later. Root cause of why the batch loses an
// input isn't confirmed yet — see the path-logging added in
// apps/server/src/orpc/handler.ts for the next occurrence.
function isTransientBatchInputLoss(error: unknown): boolean {
  return (
    error instanceof ORPCError &&
    error.code === "BAD_REQUEST" &&
    Array.isArray((error.data as { issues?: unknown[] } | undefined)?.issues) &&
    (error.data as { issues: { message?: string }[] }).issues.some((issue) =>
      issue.message?.includes("received undefined"),
    )
  );
}

export async function withLoaderRetry<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (!isTransientBatchInputLoss(error)) throw error;
    return await task();
  }
}
