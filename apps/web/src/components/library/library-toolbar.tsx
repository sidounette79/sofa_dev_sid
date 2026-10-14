import { plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import {
  IconChevronDown,
  IconFilter,
  IconSearch,
  IconSortAscending,
  IconSortDescending,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { LibraryFilters, type LibraryFiltersProps } from "@/components/library/library-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";

export interface LibraryToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filters: LibraryFiltersProps["filters"];
  onFilterChange: (key: string, value: unknown) => void;
  onClearAll: () => void;
  sortBy: string;
  sortDirection: string;
  onSortChange: (sortBy: string, sortDirection: string) => void;
  totalResults: number;
  activeFilterCount: number;
}

export function LibraryToolbar({
  search,
  onSearchChange,
  filters,
  onFilterChange,
  onClearAll,
  sortBy,
  sortDirection,
  onSortChange,
  totalResults,
  activeFilterCount,
}: LibraryToolbarProps) {
  const { t } = useLingui();
  const [filtersOpen, setFiltersOpen] = useState(false);

  const sortCategories = useMemo(
    () => [
      { label: t`Date Added`, value: "added_at", defaultDirection: "desc" },
      { label: t`Title`, value: "title", defaultDirection: "asc" },
      { label: t`Release Date`, value: "release_date", defaultDirection: "desc" },
      { label: t`Next Air Date`, value: "next_air_date", defaultDirection: "asc" },
      { label: t`Last Watched`, value: "last_watched", defaultDirection: "desc" },
      { label: t`User Rating`, value: "user_rating", defaultDirection: "desc" },
      { label: t`TMDB Rating`, value: "vote_average", defaultDirection: "desc" },
      { label: t`Popularity`, value: "popularity", defaultDirection: "desc" },
    ],
    [t],
  );

  function handleCategoryClick(category: string, defaultDirection: string) {
    onSortChange(category, sortBy === category ? sortDirection : defaultDirection);
  }

  function toggleDirection() {
    onSortChange(sortBy, sortDirection === "asc" ? "desc" : "asc");
  }

  return (
    <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 sm:max-w-xs">
          <IconSearch
            aria-hidden={true}
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2"
          />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t`Search library...`}
            className="py-3 pl-7"
            aria-label={t`Search library`}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-[13px]">
            {plural(totalResults, { one: "# result", other: "# results" })}
          </span>

          {/* Filter toggle */}
          <CollapsibleTrigger
            render={
              <Button variant="outline">
                <IconFilter aria-hidden={true} className="size-3.5" />
                {t`Filters`}
                {activeFilterCount > 0 && (
                  <Badge variant="default" className="ml-1 size-4 justify-center px-0">
                    {activeFilterCount}
                  </Badge>
                )}
                <IconChevronDown
                  aria-hidden={true}
                  className={`text-muted-foreground size-3 transition-transform duration-200 ${filtersOpen ? "rotate-180" : ""}`}
                />
              </Button>
            }
          />

          {/* Sort dropdown */}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <Button variant="outline">
                  <IconSortDescending aria-hidden={true} className="size-3.5" />
                  {sortCategories.find((c) => c.value === sortBy)?.label ?? t`Sort`}
                </Button>
              }
            />
            <DropdownMenuContent align="end">
              {sortCategories.map((category) => {
                const isActive = sortBy === category.value;
                return (
                  <DropdownMenuItem
                    key={category.value}
                    className="cursor-pointer"
                    onClick={() => handleCategoryClick(category.value, category.defaultDirection)}
                  >
                    <span className={isActive ? "text-primary font-medium" : ""}>
                      {category.label}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Direction toggle */}
          <Button
            variant="outline"
            size="icon"
            onClick={toggleDirection}
            aria-label={sortDirection === "asc" ? t`Ascending` : t`Descending`}
          >
            {sortDirection === "asc" ? (
              <IconSortAscending aria-hidden={true} className="size-3.5" />
            ) : (
              <IconSortDescending aria-hidden={true} className="size-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Collapsible filter strip */}
      <CollapsibleContent className="h-[var(--collapsible-panel-height)] overflow-hidden transition-[height] duration-200 ease-out data-[ending-style]:h-0 data-[starting-style]:h-0">
        <div className="border-border/15 border-b pt-3 pb-3">
          <LibraryFilters
            filters={filters}
            onFilterChange={onFilterChange}
            onClearAll={onClearAll}
            activeFilterCount={activeFilterCount}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
