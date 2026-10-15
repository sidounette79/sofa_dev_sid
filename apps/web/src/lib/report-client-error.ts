import { Sentry } from "@/lib/sentry";

// 14.10, Sid: see apps/server/src/routes/client-error.ts for why this
// exists. Fire-and-forget on purpose - a failure to report must never
// itself throw inside an error boundary's render.
//
// 15.10, Sid ("d'autres outils pour trouver la vraie cause"): also goes to
// Sentry now (symbolicated stack via the sourcemap upload in
// vite.config.ts - our own endpoint only ever got minified frames,
// useless for anything inside a library's own bundle, not just app code).
// Kept both: Sentry needs its DSN configured to do anything (silently
// no-ops otherwise, see lib/sentry.ts), our own endpoint has no such
// dependency and is what every earlier fix tonight was actually verified
// against.
export function reportClientError(error: unknown, componentStack?: string): void {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  Sentry.captureException(error, componentStack ? { contexts: { react: { componentStack } } } : undefined);

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
