import { Trans } from "@lingui/react/macro";
import { IconChevronDown } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getPersistedSectionOpen, setPersistedSectionOpen } from "@/lib/appearance";
export function FeedSection({
  title,
  icon,
  children,
  seeAllLink,
  seeAllSearch,
  collapsible = false,
  defaultOpen = true,
  countLabel,
  actions,
  id,
  narrow = false,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  seeAllLink?: string;
  /**
   * Query params for seeAllLink (24.08, Sid — "See all" on a status-filtered
   * section, e.g. Completed, landed on the unfiltered library instead of
   * carrying the status through). TanStack Router's `to` is path-only, so
   * this needs its own `search` prop rather than being embedded in the
   * string.
   */
  seeAllSearch?: Record<string, unknown>;
  collapsible?: boolean;
  defaultOpen?: boolean;
  countLabel?: string;
  actions?: ReactNode;
  /** Stable identifier used to persist this section's expanded/collapsed state across visits. */
  id?: string;
  /**
   * 18.11 : la section « En cours sur Emby » posée dans une colonne étroite
   * à côté des listes « derniers vus ». Capture de Sid à l'appui, son titre
   * en `text-xl` s'y empilait sur quatre lignes — un mot par ligne. En
   * `narrow` le titre descend à la taille du corps de texte et cesse d'être
   * centré, pour tenir sur une ou deux lignes dans ~130 px.
   */
  narrow?: boolean;
}) {
  const [open, setOpenState] = useState(() =>
    id ? getPersistedSectionOpen(id, defaultOpen) : defaultOpen,
  );
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (id) setPersistedSectionOpen(id, next);
  };

  const titlePart = (
    <div className={narrow ? "flex items-center gap-1.5" : "flex items-center gap-2"}>
      <span aria-hidden={true} className={narrow ? "shrink-0" : undefined}>
        {icon}
      </span>
      <h2
        className={
          narrow
            ? "font-display min-w-0 text-left text-sm leading-tight tracking-tight"
            : "font-display text-xl tracking-tight text-balance"
        }
      >
        {title}
      </h2>
      {countLabel && (
        <span className={narrow ? "text-muted-foreground text-xs" : "text-muted-foreground text-sm"}>
          {countLabel}
        </span>
      )}
    </div>
  );

  const navPart = (
    <div className="flex items-center gap-3">
      {seeAllLink && (
        <Link
          to={seeAllLink}
          search={seeAllSearch}
          className="text-primary text-sm hover:underline"
        >
          <Trans>See all</Trans>
        </Link>
      )}
      {collapsible && (
        <IconChevronDown
          aria-hidden={true}
          className={`text-muted-foreground size-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      )}
    </div>
  );

  if (!collapsible) {
    return (
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          {titlePart}
          <div className="flex items-center gap-3">
            {actions}
            {navPart}
          </div>
        </div>
        {children}
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex items-center justify-between">
          <CollapsibleTrigger className="cursor-pointer">{titlePart}</CollapsibleTrigger>
          <div className="flex items-center gap-3">
            {actions}
            <CollapsibleTrigger className="cursor-pointer">{navPart}</CollapsibleTrigger>
          </div>
        </div>
        <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
          <div className="pt-4">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
