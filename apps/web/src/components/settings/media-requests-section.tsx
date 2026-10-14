import { Trans, useLingui } from "@lingui/react/macro";
import { IconFolder } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth/client";
import { orpc } from "@/lib/orpc/client";

interface UserDefaultsFormState {
  radarrRootFolder: string | null;
  radarrQualityProfileId: number | null;
  sonarrRootFolder: string | null;
  sonarrQualityProfileId: number | null;
}

const EMPTY_DEFAULTS: UserDefaultsFormState = {
  radarrRootFolder: null,
  radarrQualityProfileId: null,
  sonarrRootFolder: null,
  sonarrQualityProfileId: null,
};

/**
 * Per-user Radarr/Sonarr root folder + quality profile — feeds the "Request"
 * dialog's fallback default (see media-requests.ts: requestMovie/Series use
 * this when the dialog doesn't pass an explicit choice). Admin-only, same
 * "Admin only" pattern as the other settings.tsx sections. Sid's real
 * household values (24.08): Mary -> FILMS/SERIES MARY, Sidounette (Pepette)
 * -> FILMS/SERIES PEPETTE, XA -> FILMS/SERIES XA (CARBA is a manual
 * per-request choice for shared content, not anyone's default).
 */
export function MediaRequestsSection() {
  const { t } = useLingui();
  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ["admin-users-list"],
    queryFn: async () => {
      const { data, error } = await authClient.admin.listUsers({ query: { limit: 100 } });
      if (error) throw new Error(error.message ?? "Failed to list users");
      return data.users;
    },
  });
  const optionsQuery = useQuery(orpc.mediaRequests.getOptions.queryOptions());
  const defaultsQuery = useQuery(orpc.mediaRequests.listUserDefaults.queryOptions());

  const setDefaultsMutation = useMutation(
    orpc.mediaRequests.setUserDefaults.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: orpc.mediaRequests.listUserDefaults.key() });
      },
    }),
  );

  if (usersQuery.isPending || optionsQuery.isPending || defaultsQuery.isPending) {
    return (
      <CardContent>
        <Skeleton className="h-32 w-full" />
      </CardContent>
    );
  }

  if (usersQuery.isError || optionsQuery.isError || defaultsQuery.isError) {
    return (
      <CardContent>
        <p className="text-destructive text-sm">
          <Trans>Failed to load — check that Radarr/Sonarr are configured and reachable.</Trans>
        </p>
      </CardContent>
    );
  }

  const users = usersQuery.data;
  const options = optionsQuery.data;
  const defaultsByUserId = new Map(defaultsQuery.data.items.map((d) => [d.userId, d]));

  function handleSave(userId: string, next: UserDefaultsFormState) {
    setDefaultsMutation.mutate(
      { userId, ...next },
      {
        onError: () => toast.error(t`Failed to save`),
      },
    );
  }

  return (
    <CardContent className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
          <IconFolder aria-hidden={true} className="text-primary size-4" />
        </div>
        <div>
          <CardTitle>
            <Trans>Request defaults</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              Default Radarr/Sonarr root folder + quality profile per user — used when someone
              requests a movie or series without picking a folder explicitly.
            </Trans>
          </CardDescription>
        </div>
      </div>

      <div className="space-y-4">
        {users.map((user) => (
          <UserDefaultsRow
            key={user.id}
            userId={user.id}
            userName={user.name}
            options={options}
            initial={defaultsByUserId.get(user.id) ?? EMPTY_DEFAULTS}
            onSave={(next) => handleSave(user.id, next)}
          />
        ))}
      </div>
    </CardContent>
  );
}

function UserDefaultsRow({
  userId: _userId,
  userName,
  options,
  initial,
  onSave,
}: {
  userId: string;
  userName: string;
  options: {
    radarr: { rootFolders: { path: string }[]; qualityProfiles: { id: number; name: string }[] };
    sonarr: { rootFolders: { path: string }[]; qualityProfiles: { id: number; name: string }[] };
  };
  initial: UserDefaultsFormState;
  onSave: (next: UserDefaultsFormState) => void;
}) {
  const { t } = useLingui();
  const [state, setState] = useState(initial);

  // Re-sync if the server value changes underneath us (e.g. another admin
  // session edited it) — mirrors the invalidate-on-save above.
  useEffect(() => setState(initial), [initial]);

  function update(patch: Partial<UserDefaultsFormState>) {
    const next = { ...state, ...patch };
    setState(next);
    onSave(next);
  }

  return (
    <div className="border-border/50 space-y-3 rounded-lg border p-3">
      <p className="text-sm font-medium">{userName}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            <Trans>Radarr root folder</Trans>
          </p>
          <Select
            value={state.radarrRootFolder ?? undefined}
            onValueChange={(v) => update({ radarrRootFolder: v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t`None`} />
            </SelectTrigger>
            <SelectContent>
              {options.radarr.rootFolders.map((f) => (
                <SelectItem key={f.path} value={f.path}>
                  {f.path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            <Trans>Radarr quality profile</Trans>
          </p>
          <Select
            value={state.radarrQualityProfileId ? String(state.radarrQualityProfileId) : undefined}
            onValueChange={(v) => update({ radarrQualityProfileId: Number(v) })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t`None`}>
                {(value: string | null) =>
                  options.radarr.qualityProfiles.find((p) => String(p.id) === value)?.name ?? value
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.radarr.qualityProfiles.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            <Trans>Sonarr root folder</Trans>
          </p>
          <Select
            value={state.sonarrRootFolder ?? undefined}
            onValueChange={(v) => update({ sonarrRootFolder: v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t`None`} />
            </SelectTrigger>
            <SelectContent>
              {options.sonarr.rootFolders.map((f) => (
                <SelectItem key={f.path} value={f.path}>
                  {f.path}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <p className="text-muted-foreground text-xs">
            <Trans>Sonarr quality profile</Trans>
          </p>
          <Select
            value={state.sonarrQualityProfileId ? String(state.sonarrQualityProfileId) : undefined}
            onValueChange={(v) => update({ sonarrQualityProfileId: Number(v) })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t`None`}>
                {(value: string | null) =>
                  options.sonarr.qualityProfiles.find((p) => String(p.id) === value)?.name ?? value
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {options.sonarr.qualityProfiles.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
