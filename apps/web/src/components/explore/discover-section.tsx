import { useLingui } from "@lingui/react/macro";
import { IconLoader, IconSearch } from "@tabler/icons-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { FeedSection } from "@/components/dashboard/feed-section";
import { TitleGrid } from "@/components/dashboard/title-grid";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInfiniteScroll } from "@/hooks/use-infinite-scroll";
import { translateGenreName } from "@/lib/genre-names";
import { orpc } from "@/lib/orpc/client";

type DiscoverSortBy =
  | "popularity.desc"
  | "vote_average.desc"
  | "primary_release_date.desc"
  | "primary_release_date.asc";

export interface DiscoverSearch {
  discoverType?: "movie" | "tv";
  discoverGenreId?: number;
  discoverYearMin?: number;
  discoverYearMax?: number;
  discoverRatingMin?: number;
  discoverSortBy?: DiscoverSortBy;
  discoverLanguage?: string;
  discoverPlatformId?: string;
}

const DECADE_PRESETS = [
  { label: "2020s", min: 2020, max: 2029 },
  { label: "2010s", min: 2010, max: 2019 },
  { label: "2000s", min: 2000, max: 2009 },
  { label: "1990s", min: 1990, max: 1999 },
  { label: "1980s", min: 1980, max: 1989 },
  { label: "1970s", min: 1970, max: 1979 },
  { label: "Pre-1970", min: 1900, max: 1969 },
] as const;

const RATING_PRESETS = [
  { label: "7+", value: 7 },
  { label: "6+", value: 6 },
  { label: "5+", value: 5 },
] as const;

const SORT_OPTIONS = [
  { value: "popularity.desc", labelKey: "Most popular" },
  { value: "vote_average.desc", labelKey: "Highest rated" },
  { value: "primary_release_date.desc", labelKey: "Newest" },
  { value: "primary_release_date.asc", labelKey: "Oldest" },
] as const;

const LANGUAGE_OPTIONS = [
  { code: "en", name: "English" },
  { code: "es", name: "Spanish" },
  { code: "fr", name: "French" },
  { code: "de", name: "German" },
  { code: "ja", name: "Japanese" },
  { code: "ko", name: "Korean" },
  { code: "zh", name: "Chinese" },
  { code: "hi", name: "Hindi" },
  { code: "it", name: "Italian" },
  { code: "pt", name: "Portuguese" },
] as const;

export function DiscoverSection({
  search,
  onSearchChange,
}: {
  search: DiscoverSearch;
  onSearchChange: (opts: { search: (prev: DiscoverSearch) => DiscoverSearch }) => void;
}) {
  const { t } = useLingui();

  const type = search.discoverType ?? "movie";
  const genreId = search.discoverGenreId;
  const yearMin = search.discoverYearMin;
  const yearMax = search.discoverYearMax;
  const ratingMin = search.discoverRatingMin;
  const sortBy = search.discoverSortBy;
  const language = search.discoverLanguage;
  const platformId = search.discoverPlatformId;

  function updateSearch(patch: Partial<DiscoverSearch>) {
    onSearchChange({ search: (prev) => ({ ...prev, ...patch }) });
  }
  function setType(value: "movie" | "tv") {
    // Same reset as before: a genre/provider id from one media type is
    // meaningless (often outright invalid) for the other.
    updateSearch({
      discoverType: value,
      discoverGenreId: undefined,
      discoverPlatformId: undefined,
    });
  }
  function setGenreId(value: number | undefined) {
    updateSearch({ discoverGenreId: value });
  }
  function setRatingMin(value: number | undefined) {
    updateSearch({ discoverRatingMin: value });
  }
  function setSortBy(value: DiscoverSortBy | undefined) {
    updateSearch({ discoverSortBy: value });
  }
  function setLanguage(value: string | undefined) {
    updateSearch({ discoverLanguage: value });
  }
  function setPlatformId(value: string | undefined) {
    updateSearch({ discoverPlatformId: value });
  }

  const { data: genreData } = useQuery(orpc.discover.genres.queryOptions({ input: { type } }));
  const { data: providerData } = useQuery(orpc.discover.platforms.queryOptions());

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } = useInfiniteQuery(
    orpc.discover.browse.infiniteOptions({
      input: (pageParam: number) => ({
        type,
        genreId,
        yearMin,
        yearMax,
        ratingMin,
        sortBy,
        language,
        platformId,
        page: pageParam,
      }),
      initialPageParam: 1,
      getNextPageParam: (lastPage) =>
        lastPage.page < lastPage.totalPages ? lastPage.page + 1 : undefined,
      maxPages: 10,
    }),
  );

  const sentinelRef = useInfiniteScroll({
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  });

  // 28.08, Sid — real bug found live: unlike ExplorePage's Trending/Popular
  // rows (which merge userStatuses/episodeProgress from each page via
  // mergeMaps before handing items to TitleRow), this just flattened
  // `items` straight from the pages — userStatuses/episodeProgress exist on
  // each page's response (BrowseOutput, same shape discover.browse always
  // returns) but were never read. A title with a real personal status (e.g.
  // she'd already requested it) still showed no badge at all here, even
  // though the exact same title showed one correctly in Films populaires.
  const items = useMemo(() => {
    const pages = data?.pages ?? [];
    const userStatuses = Object.assign({}, ...pages.map((p) => p.userStatuses));
    const episodeProgress = Object.assign({}, ...pages.map((p) => p.episodeProgress));
    // 06.09, Sid: "j'ai des films à triple" — TMDB's own discover endpoint
    // can shift results between page fetches for a volatile sort like
    // popularity.desc (an item's rank moves between the two HTTP calls),
    // so naively concatenating pages can repeat the same title. De-dupe by
    // id, keeping the first (earliest-page) occurrence.
    const seenIds = new Set<string>();
    return pages
      .flatMap((p) =>
        p.items.map((item) => ({
          ...item,
          userStatus: userStatuses[item.id],
          episodeProgress: episodeProgress[item.id],
        })),
      )
      .filter((item) => {
        if (seenIds.has(item.id)) return false;
        seenIds.add(item.id);
        return true;
      });
  }, [data?.pages]);

  const genres = genreData?.genres ?? [];
  const providers = providerData?.platforms ?? [];

  const sortLabels: Record<string, string> = {
    "popularity.desc": t`Most popular`,
    "vote_average.desc": t`Highest rated`,
    "primary_release_date.desc": t`Newest`,
    "primary_release_date.asc": t`Oldest`,
  };

  const languageNames: Record<string, string> = {
    en: t`English`,
    es: t`Spanish`,
    fr: t`French`,
    de: t`German`,
    ja: t`Japanese`,
    ko: t`Korean`,
    zh: t`Chinese`,
    hi: t`Hindi`,
    it: t`Italian`,
    pt: t`Portuguese`,
  };

  function handleDecadeChange(value: string | null) {
    if (!value) {
      updateSearch({ discoverYearMin: undefined, discoverYearMax: undefined });
      return;
    }
    const preset = DECADE_PRESETS.find((d) => String(d.min) === value);
    if (preset) {
      updateSearch({ discoverYearMin: preset.min, discoverYearMax: preset.max });
    }
  }

  function handleRatingChange(value: string | null) {
    if (!value) {
      setRatingMin(undefined);
      return;
    }
    setRatingMin(Number(value));
  }

  function handleSortChange(value: string | null) {
    setSortBy((value || undefined) as DiscoverSortBy | undefined);
  }

  function handleLanguageChange(value: string | null) {
    setLanguage(value || undefined);
  }

  function handleProviderChange(value: string | null) {
    setPlatformId(value || undefined);
  }

  function handleGenreChange(value: string | null) {
    if (!value) {
      setGenreId(undefined);
      return;
    }
    setGenreId(Number(value));
  }

  return (
    // 17.10, Sid: kept distinct from the nav bar's own "Découvrir" tab
    // label (/explore itself) - this component now lives only on its own
    // /explore/discover page (explore.discover.tsx), see that route's own
    // comment for why.
    <FeedSection title={t`Advanced Search`} icon={<IconSearch className="text-primary size-5" />}>
      <div className="flex flex-wrap items-center gap-2">
        {/* Type toggle: Movie | TV */}
        <ToggleGroup
          value={[type]}
          onValueChange={(values) => {
            const next = values.find((v) => v !== type);
            if (next === "movie" || next === "tv") {
              setType(next);
            }
          }}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="movie">{t`Movie`}</ToggleGroupItem>
          <ToggleGroupItem value="tv">{t`TV`}</ToggleGroupItem>
        </ToggleGroup>

        {/* Divider */}
        <div className="bg-border/30 mx-0.5 hidden h-5 w-px sm:block" />

        {/* Genre select */}
        <Select
          value={genreId != null ? String(genreId) : ""}
          onValueChange={handleGenreChange}
          modal={false}
          aria-label={t`Genre`}
        >
          <SelectTrigger
            size="sm"
            data-active={genreId != null ? "" : undefined}
            className="data-[active]:border-primary/40 data-[active]:text-foreground"
          >
            <SelectValue>
              {(value: string | null) => {
                if (!value) return t`Genre`;
                const genre = genres.find((g) => String(g.id) === value);
                return genre?.name ?? t`Genre`;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="p-1">
            <SelectItem value="">{t`All genres`}</SelectItem>
            {genres.map((genre) => (
              <SelectItem key={genre.id} value={String(genre.id)}>
                {translateGenreName(genre.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Year select (decade presets) */}
        <Select
          value={yearMin != null ? String(yearMin) : ""}
          onValueChange={handleDecadeChange}
          modal={false}
          aria-label={t`Decade`}
        >
          <SelectTrigger
            size="sm"
            data-active={yearMin != null ? "" : undefined}
            className="data-[active]:border-primary/40 data-[active]:text-foreground"
          >
            <SelectValue>
              {(value: string | null) => {
                if (!value) return t`Year`;
                const preset = DECADE_PRESETS.find((d) => String(d.min) === value);
                if (preset?.min === 1900) return t`Pre-1970`;
                return preset?.label ?? t`Year`;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="p-1">
            <SelectItem value="">{t`Any year`}</SelectItem>
            {DECADE_PRESETS.map((d) => (
              <SelectItem key={d.min} value={String(d.min)}>
                {d.min === 1900 ? t`Pre-1970` : d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Rating select (minimum TMDB rating) */}
        <Select
          value={ratingMin != null ? String(ratingMin) : ""}
          onValueChange={handleRatingChange}
          modal={false}
          aria-label={t`Rating`}
        >
          <SelectTrigger
            size="sm"
            data-active={ratingMin != null ? "" : undefined}
            className="data-[active]:border-primary/40 data-[active]:text-foreground"
          >
            <SelectValue>
              {(value: string | null) => {
                if (!value) return t`Rating`;
                return `${value}+`;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="p-1">
            <SelectItem value="">{t`Any rating`}</SelectItem>
            {RATING_PRESETS.map((r) => (
              <SelectItem key={r.value} value={String(r.value)}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Sort select */}
        <Select
          value={sortBy ?? ""}
          onValueChange={handleSortChange}
          modal={false}
          aria-label={t`Sort`}
        >
          <SelectTrigger
            size="sm"
            data-active={sortBy ? "" : undefined}
            className="data-[active]:border-primary/40 data-[active]:text-foreground"
          >
            <SelectValue>
              {(value: string | null) => {
                if (!value) return t`Sort`;
                return sortLabels[value] ?? t`Sort`;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="p-1">
            <SelectItem value="">{t`Default`}</SelectItem>
            {SORT_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {sortLabels[s.value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Language select */}
        <Select
          value={language ?? ""}
          onValueChange={handleLanguageChange}
          modal={false}
          aria-label={t`Language`}
        >
          <SelectTrigger
            size="sm"
            data-active={language ? "" : undefined}
            className="data-[active]:border-primary/40 data-[active]:text-foreground"
          >
            <SelectValue>
              {(value: string | null) => {
                if (!value) return t`Language`;
                return languageNames[value] ?? t`Language`;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="p-1">
            <SelectItem value="">{t`Any language`}</SelectItem>
            {LANGUAGE_OPTIONS.map((lang) => (
              <SelectItem key={lang.code} value={lang.code}>
                {languageNames[lang.code]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Provider select */}
        <Select
          value={platformId ?? ""}
          onValueChange={handleProviderChange}
          modal={false}
          aria-label={t`Provider`}
        >
          <SelectTrigger
            size="sm"
            data-active={platformId ? "" : undefined}
            className="data-[active]:border-primary/40 data-[active]:text-foreground"
          >
            <SelectValue>
              {(value: string | null) => {
                if (!value) return t`Provider`;
                const platform = providers.find((p) => p.id === value);
                return platform?.name ?? t`Provider`;
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent className="p-1">
            <SelectItem value="">{t`All providers`}</SelectItem>
            {providers
              .filter((p) => p.tmdbProviderIds.length > 0)
              .map((platform) => (
                <SelectItem key={platform.id} value={platform.id}>
                  {platform.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      {/* Results */}
      {isPending ? (
        <div className="flex items-center justify-center py-12">
          <IconLoader className="text-muted-foreground size-6 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {t`No titles found. Try adjusting your filters.`}
        </p>
      ) : (
        <>
          <TitleGrid items={items} />
          <div ref={sentinelRef} />
          {isFetchingNextPage && (
            <div className="flex items-center justify-center py-4">
              <IconLoader className="text-muted-foreground size-5 animate-spin" />
            </div>
          )}
        </>
      )}
    </FeedSection>
  );
}
