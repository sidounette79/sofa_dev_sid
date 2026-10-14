import { useLingui } from "@lingui/react/macro";
import {
  IconDeviceTv,
  IconMovie,
  IconSearch,
  IconServer2,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";

import { useDebounce } from "@/hooks/use-debounce";
import { MAX_RECENT, recentSearchesAtom } from "@/lib/atoms/command-palette";
import { orpc } from "@/lib/orpc/client";

// 17.09, Sid: "j'aimerais transformer un peu la page découvrir, pour
// qu'elle se rapproche encore un peu plus de seer... remettre un champ de
// recherche en grand" — then, same session, "dans jellyseer, si je tape le
// pull sans rien taper d'autre, j'ai deja des propositions qui s'affichent
// ... On peut se passer du enter?" then "le nouveau champ de recherche ne
// garde pas l'historique". First version required Enter (handed off to the
// existing /search route); this shows the same live dropdown the command
// palette (Cmd+K) already renders, just inline instead of in a modal, and
// reuses the SAME `recentSearchesAtom` (shared localStorage-backed jotai
// atom) so history is shared between both search entry points, not a
// second separate history. Enter still works too, as a shortcut to the
// full results page.
interface SearchResult {
  id?: string;
  tmdbId: number;
  type: "movie" | "tv" | "person";
  title: string;
  posterPath: string | null;
  profilePath: string | null;
  releaseDate: string | null;
  embyStatus: "available" | "removed" | null;
}

export function DiscoverSearchBar() {
  const { t } = useLingui();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useAtom(recentSearchesAtom);
  const debouncedQuery = useDebounce(query, 300);
  const trimmedQuery = debouncedQuery.trim();

  const { data: searchData, isLoading } = useQuery(
    orpc.discover.search.queryOptions({
      input: trimmedQuery ? { query: trimmedQuery } : skipToken,
    }),
  );
  const results: SearchResult[] = searchData?.results?.slice(0, 6) ?? [];
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Same "save after the user settles on a query with real results" rule
  // as the command palette, so both share one history without saving every
  // half-typed keystroke.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>(null);
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (trimmedQuery && results.length > 0) {
      saveTimerRef.current = setTimeout(() => {
        setRecentSearches((prev) => {
          const filtered = prev.filter((q) => q !== trimmedQuery);
          return [trimmedQuery, ...filtered].slice(0, MAX_RECENT);
        });
      }, 2000);
    }
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [trimmedQuery, results.length, setRecentSearches]);

  function goToFullResults() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setOpen(false);
    void navigate({ to: "/search", search: { q: trimmed } });
  }

  function goToResult(result: SearchResult) {
    if (!result.id) return;
    setOpen(false);
    setQuery("");
    if (result.type === "person") {
      void navigate({ to: "/people/$id", params: { id: result.id } });
    } else {
      void navigate({ to: "/titles/$id", params: { id: result.id } });
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    goToFullResults();
  }

  function handleRecentSearch(q: string) {
    setQuery(q);
    setOpen(true);
  }

  function handleRemoveRecent(q: string) {
    setRecentSearches((prev) => prev.filter((s) => s !== q));
  }

  function handleClearRecent() {
    setRecentSearches([]);
  }

  return (
    <div ref={containerRef} className="relative mx-auto w-full max-w-2xl">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <IconSearch
            aria-hidden={true}
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder={t`Search movies & TV shows…`}
            aria-label={t`Search movies & TV shows`}
            className="bg-card/80 border-border/60 text-foreground placeholder:text-muted-foreground focus-visible:ring-primary/40 h-12 w-full rounded-full border pr-4 pl-12 text-base shadow-sm backdrop-blur-sm transition-shadow outline-none focus-visible:ring-2"
          />
        </div>
      </form>

      {open && !hasQuery && recentSearches.length > 0 && (
        <div className="bg-popover border-border/60 absolute inset-x-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border shadow-lg">
          <div className="flex items-center justify-between px-3 pt-2.5 pb-1">
            <span className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
              {t`Recent Searches`}
            </span>
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleClearRecent();
              }}
              className="text-muted-foreground hover:text-foreground text-xs transition-colors"
            >
              {t`Clear all`}
            </button>
          </div>
          <div className="p-1.5 pt-0.5">
            {recentSearches.map((q) => (
              <div
                key={q}
                className="hover:bg-accent group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors"
              >
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleRecentSearch(q);
                  }}
                  className="flex flex-1 items-center gap-2.5 text-left"
                >
                  <IconSearch aria-hidden={true} className="text-muted-foreground size-3.5" />
                  <span className="flex-1 truncate text-sm">{q}</span>
                </button>
                <button
                  type="button"
                  aria-label={t`Remove from recent searches`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleRemoveRecent(q);
                  }}
                  className="text-muted-foreground hover:text-foreground rounded-sm p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                >
                  <IconX className="size-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {open && hasQuery && (
        <div className="bg-popover border-border/60 absolute inset-x-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-2xl border shadow-lg">
          {isLoading ? (
            <div className="space-y-2 p-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={`skel-${i}`} className="flex items-center gap-3 px-2 py-1.5">
                  <div className="bg-muted h-12 w-8 shrink-0 animate-pulse rounded" />
                  <div className="flex-1 space-y-1.5">
                    <div className="bg-muted h-3.5 w-3/4 animate-pulse rounded" />
                    <div className="bg-muted h-3 w-1/3 animate-pulse rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : results.length === 0 ? (
            <p className="text-muted-foreground p-4 text-center text-sm">{t`No results found`}</p>
          ) : (
            <div className="p-1.5">
              {results.map((r) => (
                <button
                  key={r.id ?? `${r.type}-${r.tmdbId}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    goToResult(r);
                  }}
                  className="hover:bg-accent flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors"
                >
                  {r.type === "person" ? (
                    <div className="bg-muted size-10 shrink-0 overflow-hidden rounded-full">
                      {r.profilePath ? (
                        <img
                          src={r.profilePath}
                          alt={r.title}
                          width={40}
                          height={40}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center">
                          <IconUser aria-hidden={true} className="text-muted-foreground size-4" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="bg-muted h-12 w-8 shrink-0 overflow-hidden rounded">
                      {r.posterPath ? (
                        <img
                          src={r.posterPath}
                          alt={r.title}
                          width={32}
                          height={48}
                          loading="lazy"
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="text-muted-foreground flex h-full items-center justify-center text-[8px]">
                          ?
                        </div>
                      )}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                      {r.type === "person" ? (
                        <IconUser aria-hidden={true} className="size-3" />
                      ) : r.type === "movie" ? (
                        <IconMovie aria-hidden={true} className="size-3" />
                      ) : (
                        <IconDeviceTv aria-hidden={true} className="size-3" />
                      )}
                      <span className="uppercase">
                        {r.type === "movie" ? t`movie` : r.type === "tv" ? t`tv` : t`person`}
                      </span>
                      {r.type !== "person" && r.releaseDate && <span>{r.releaseDate.slice(0, 4)}</span>}
                      {r.type !== "person" && r.embyStatus === "available" && (
                        <span className="text-status-completed flex items-center gap-0.5">
                          <IconServer2 aria-hidden={true} className="size-3" />
                          {t`On your server`}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {(searchData?.totalResults ?? 0) > results.length && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    goToFullResults();
                  }}
                  className="text-muted-foreground hover:bg-accent hover:text-foreground w-full rounded-lg px-2.5 py-2 text-center text-sm transition-colors"
                >
                  {t`See all ${searchData?.totalResults} results`}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
