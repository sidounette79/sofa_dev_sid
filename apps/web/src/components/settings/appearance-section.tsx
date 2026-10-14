import { Trans, useLingui } from "@lingui/react/macro";
import { IconCheck, IconChevronDown, IconPalette } from "@tabler/icons-react";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  ACCENT_PRESETS,
  getPersistedAccent,
  getPersistedGridColumns,
  getPersistedHomePage,
  type HomePage,
  setPersistedAccent,
  setPersistedGridColumns,
  setPersistedHomePage,
} from "@/lib/appearance";

export function AppearanceSection() {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const [accent, setAccent] = useState(() => getPersistedAccent());
  const [columns, setColumns] = useState(() => getPersistedGridColumns());
  const [homePage, setHomePage] = useState(() => getPersistedHomePage());
  const currentPreset = ACCENT_PRESETS.find((p) => p.id === accent);

  const HOME_PAGE_OPTIONS: { id: HomePage; label: string }[] = [
    { id: "library-tv", label: t`TV Shows` },
    { id: "library-movie", label: t`Movies` },
    { id: "explore", label: t`Discover` },
    { id: "upcoming", label: t`Upcoming` },
    { id: "statistics", label: t`Stats` },
  ];

  function handleAccentChange(id: string) {
    setAccent(id);
    setPersistedAccent(id);
  }

  function handleColumnsChange(count: number) {
    setColumns(count);
    setPersistedGridColumns(count);
  }

  function handleHomePageChange(page: HomePage) {
    setHomePage(page);
    setPersistedHomePage(page);
  }

  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardContent className={open ? "pb-4" : ""}>
          <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="bg-primary/10 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
                <IconPalette className="text-primary size-4" />
              </div>
              <div className="text-start">
                <CardTitle>
                  <Trans>Appearance</Trans>
                </CardTitle>
                <CardDescription>{currentPreset?.name ?? "Amber"}</CardDescription>
              </div>
            </div>
            <IconChevronDown
              aria-hidden={true}
              className={`text-muted-foreground size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
            />
          </CollapsibleTrigger>
        </CardContent>
        <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
          <CardContent className="border-border/30 space-y-5 border-t pt-4">
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
                <Trans>Accent color</Trans>
              </p>
              <div className="flex flex-wrap gap-2">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleAccentChange(preset.id)}
                    aria-label={preset.name}
                    aria-pressed={accent === preset.id}
                    className="relative flex size-9 items-center justify-center rounded-full border-2 transition-colors"
                    style={{
                      backgroundColor: preset.swatch,
                      borderColor: accent === preset.id ? preset.swatch : "transparent",
                    }}
                  >
                    {accent === preset.id && (
                      <IconCheck className="size-4 text-black/70" strokeWidth={3} />
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
                <Trans>Posters per row</Trans>
              </p>
              <div className="flex flex-wrap gap-2">
                {[3, 4, 5, 6, 7, 8].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => handleColumnsChange(count)}
                    aria-pressed={columns === count}
                    className={`flex size-9 items-center justify-center rounded-lg border text-sm font-medium transition-colors ${
                      columns === count
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    {count}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-muted-foreground mb-2 text-xs font-medium tracking-wider uppercase">
                <Trans>Home page</Trans>
              </p>
              <div className="flex flex-wrap gap-2">
                {HOME_PAGE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => handleHomePageChange(option.id)}
                    aria-pressed={homePage === option.id}
                    className={`flex h-9 items-center rounded-lg border px-3 text-sm font-medium transition-colors ${
                      homePage === option.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/40"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
