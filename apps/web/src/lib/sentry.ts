// 15.10, Sid ("d'autres outils pour trouver la vraie cause, meme si elle
// fonctionne?"): the removeChild/insertBefore race (see main.tsx) kept
// moving between two targeted fixes without converging - this gives real
// symbolicated stack traces + breadcrumbs instead of hand-rolled logging.
// Mirrors the native app's Sentry setup (apps/native/src/lib/sentry.ts,
// same myown-o3 org) - crashes/errors only, no performance tracing or
// session replay (this app has no opt-in toggle for it like the native
// app's crash-reporting setting, so it stays off by default rather than
// silently recording sessions).
import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN ?? "";

export function initSentry(): void {
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.DEV ? "development" : "production",
    release: __GIT_COMMIT_SHA__ || undefined,

    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,

    beforeSend(event) {
      delete event.user;
      delete event.request;
      return event;
    },
  });
}

export { Sentry };
