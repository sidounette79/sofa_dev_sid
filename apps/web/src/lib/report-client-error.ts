// 14.10, Sid: see apps/server/src/routes/client-error.ts for why this
// exists. Fire-and-forget on purpose - a failure to report must never
// itself throw inside an error boundary's render.
export function reportClientError(error: unknown, componentStack?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      stack,
      componentStack,
      url: window.location.href,
      userAgent: navigator.userAgent,
    }),
  }).catch(() => undefined);
}
