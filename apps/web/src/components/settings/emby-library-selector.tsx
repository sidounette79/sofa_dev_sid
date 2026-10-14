import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { orpc } from "@/lib/orpc/client";

export function EmbyLibrarySelector() {
  const { t } = useLingui();
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery(orpc.account.integrations.listEmbyLibraries.queryOptions());
  const [selected, setSelected] = useState<string[] | null>(null);

  useEffect(() => {
    if (data && selected === null) {
      setSelected(data.selected);
    }
  }, [data, selected]);

  const updateMutation = useMutation(
    orpc.account.integrations.updateEmbyLibraries.mutationOptions({
      onSuccess: () => {
        toast.success(t`Emby libraries saved`);
        queryClient.invalidateQueries({
          queryKey: orpc.account.integrations.listEmbyLibraries.queryOptions().queryKey,
        });
      },
      onError: () => toast.error(t`Failed to save Emby libraries`),
    }),
  );

  if (isPending || !data) return null;

  function toggle(name: string, checked: boolean) {
    const current = selected ?? [];
    const next = checked ? [...current, name] : current.filter((n) => n !== name);
    setSelected(next);
    updateMutation.mutate({ libraryNames: next });
  }

  if (data.libraries.length === 0) return null;

  return (
    <div>
      <Label className="text-muted-foreground mb-2">{t`Your Emby libraries`}</Label>
      <p className="text-muted-foreground/70 mb-2 text-xs">
        {t`Titles found in these libraries are automatically added to your watchlist.`}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {data.libraries.map((name) => (
          <label key={name} className="flex cursor-pointer items-center gap-2 text-xs">
            <Checkbox
              checked={(selected ?? data.selected).includes(name)}
              onCheckedChange={(checked) => toggle(name, checked === true)}
            />
            {name}
          </label>
        ))}
      </div>
    </div>
  );
}
