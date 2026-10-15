import { Trans } from "@lingui/react/macro";
import {
  IconAlertTriangle,
  IconChevronRight,
  IconClockHour4,
  IconDatabaseExport,
  IconFolder,
  IconServer2,
  IconShieldLock,
  IconUser,
  IconWebhook,
} from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { RouteError } from "@/components/route-error";
import { AccountSection } from "@/components/settings/account-section";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { BackupRestoreSection } from "@/components/settings/backup-restore-section";
import { BackupScheduleSection } from "@/components/settings/backup-schedule-section";
import { BackupSection } from "@/components/settings/backup-section";
import { CacheSection } from "@/components/settings/danger-section";
import { IntegrationsSection } from "@/components/settings/integrations-section";
import { LanguageSection } from "@/components/settings/language-section";
import { MediaRequestsSection } from "@/components/settings/media-requests-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { RegistrationSection } from "@/components/settings/registration-section";
import { SettingsShell } from "@/components/settings/settings-shell";
import { SystemHealthCards } from "@/components/settings/system-health-section";
import { UpdateCheckSection } from "@/components/settings/update-check-section";
import { TmdbLogo } from "@/components/tmdb-logo";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { withLoaderRetry } from "@/lib/loader-retry";
import { orpc } from "@/lib/orpc/client";

const GITHUB_REPO = "jakejarvis/sofa";

export const Route = createFileRoute("/_app/settings")({
  staleTime: 30_000,
  loader: async ({ context }) => {
    const isAdmin = context.session.user.role === "admin";
    await withLoaderRetry(() => {
      const promises: Promise<unknown>[] = [
        context.queryClient.ensureQueryData(orpc.account.integrations.list.queryOptions()),
        context.queryClient.ensureQueryData(orpc.system.status.queryOptions()),
        context.queryClient.ensureQueryData(orpc.discover.platforms.queryOptions()),
        context.queryClient.ensureQueryData(orpc.account.platforms.queryOptions()),
      ];
      if (isAdmin) {
        promises.push(
          context.queryClient.ensureQueryData(orpc.admin.systemHealth.queryOptions()),
          context.queryClient.ensureQueryData(orpc.admin.backups.list.queryOptions()),
          context.queryClient.ensureQueryData(orpc.admin.backups.schedule.queryOptions()),
          context.queryClient.ensureQueryData(orpc.mediaRequests.getOptions.queryOptions()),
          context.queryClient.ensureQueryData(orpc.mediaRequests.listUserDefaults.queryOptions()),
        );
      }
      return Promise.all(promises);
    });
  },
  head: () => ({ meta: [{ title: "Settings — Patoune TV" }] }),
  pendingComponent: SettingsSkeleton,
  errorComponent: RouteError,
  component: SettingsPage,
});

function SettingsSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Skeleton className="size-5 rounded" />
          <Skeleton className="h-8 w-32" />
        </div>
        <Skeleton className="mt-2 h-4 w-56" />
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

function SettingsPage() {
  const { session } = Route.useRouteContext();
  const isAdmin = session.user.role === "admin";

  return (
    <SettingsShell>
      <div>
        <div className="mb-3 flex items-center gap-2">
          <IconUser aria-hidden={true} className="text-muted-foreground size-4" />
          <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            <Trans>Account</Trans>
          </h2>
        </div>
        <div className="space-y-2.5">
          <AccountSection
            user={{
              name: session.user.name,
              email: session.user.email,
              image: session.user.image || undefined,
              createdAt: new Date(session.user.createdAt).toISOString(),
              role: session.user.role ?? undefined,
            }}
          />
          <LanguageSection />
          <AppearanceSection />
          <Card>
            <NotificationsSection />
          </Card>
          {/* 15.10, Sid: "En attente" — a real nav tab on desktop
              (nav-bar.tsx), but the mobile bottom bar is already full at 6
              slots, so it's reachable from here instead on mobile only. */}
          <Link
            to="/requests"
            className="ring-foreground/10 hover:bg-card/50 flex items-center justify-between gap-2 rounded-lg px-4 py-3 text-sm font-medium ring-1 transition-colors sm:hidden"
          >
            <span className="flex items-center gap-2">
              <IconClockHour4 aria-hidden={true} className="text-muted-foreground size-4" />
              <Trans>Pending</Trans>
            </span>
            <IconChevronRight aria-hidden={true} className="text-muted-foreground size-4" />
          </Link>
        </div>
      </div>

      {/* Integrations */}
      <div>
        <div className="mb-3 flex items-center gap-2">
          <IconWebhook aria-hidden={true} className="text-muted-foreground size-4" />
          <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
            <Trans>Integrations</Trans>
          </h2>
        </div>
        <IntegrationsSection />
      </div>

      {/* Server health */}
      {isAdmin && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <IconServer2 aria-hidden={true} className="text-muted-foreground size-4" />
            <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              <Trans>Server</Trans>
            </h2>
            <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-[10px] font-medium">
              <Trans>Admin only</Trans>
            </span>
          </div>
          <SystemHealthCards />
        </div>
      )}

      {/* Security */}
      {isAdmin && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <IconShieldLock aria-hidden={true} className="text-muted-foreground size-4" />
            <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              <Trans>Security</Trans>
            </h2>
            <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-[10px] font-medium">
              <Trans>Admin only</Trans>
            </span>
          </div>
          <div className="space-y-2.5">
            <Card className="border-s-primary/30 border-s-2">
              <RegistrationSection />
            </Card>
            <Card className="border-s-primary/30 border-s-2">
              <UpdateCheckSection />
            </Card>
          </div>
        </div>
      )}

      {/* Backups */}
      {isAdmin && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <IconDatabaseExport aria-hidden={true} className="text-muted-foreground size-4" />
            <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              <Trans>Backups</Trans>
            </h2>
            <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-[10px] font-medium">
              <Trans>Admin only</Trans>
            </span>
          </div>
          <div className="space-y-2.5">
            <Card className="border-s-primary/30 border-s-2">
              <BackupSection />
            </Card>
            <Card className="border-s-primary/30 border-s-2">
              <BackupScheduleSection />
            </Card>
            <Card className="border-s-primary/30 border-s-2">
              <BackupRestoreSection />
            </Card>
          </div>
        </div>
      )}

      {/* Media requests */}
      {isAdmin && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <IconFolder aria-hidden={true} className="text-muted-foreground size-4" />
            <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              <Trans>Media Requests</Trans>
            </h2>
            <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-[10px] font-medium">
              <Trans>Admin only</Trans>
            </span>
          </div>
          <Card className="border-s-primary/30 border-s-2">
            <MediaRequestsSection />
          </Card>
        </div>
      )}

      {/* Cache */}
      {isAdmin && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <IconAlertTriangle aria-hidden={true} className="text-destructive size-4" />
            <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              <Trans>Danger Zone</Trans>
            </h2>
            <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-[10px] font-medium">
              <Trans>Admin only</Trans>
            </span>
          </div>
          <Card className="border-s-primary/30 border-s-2">
            <CacheSection />
          </Card>
        </div>
      )}

      <footer className="border-border/50 text-muted-foreground border-t pt-6 pb-2 text-center text-xs">
        <p>
          <a
            href="https://sofa.watch"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary/80 hover:text-primary font-medium transition-colors"
          >
            Sofa
          </a>{" "}
          v{__APP_VERSION__}
          {__GIT_COMMIT_SHA__ && (
            <>
              {" "}
              (
              <a
                href={`https://github.com/${GITHUB_REPO}/commit/${__GIT_COMMIT_SHA__}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary font-mono transition-colors"
              >
                {__GIT_COMMIT_SHA__}
              </a>
              )
            </>
          )}
        </p>
        <div className="mt-4 flex flex-col items-center gap-2">
          <a
            href="https://www.themoviedb.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-opacity hover:opacity-70"
          >
            <TmdbLogo className="h-3" />
          </a>
          <p className="text-muted-foreground text-[10px] leading-relaxed">
            <Trans>This product uses the TMDB API but is not endorsed or certified by TMDB.</Trans>
          </p>
        </div>
      </footer>
    </SettingsShell>
  );
}
