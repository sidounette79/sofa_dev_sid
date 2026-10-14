import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { translateGenreName } from "@/lib/genre-names";

export function GenreCollapse({ genres }: { genres: string[] }) {
  if (genres.length === 0) return null;
  if (genres.length === 1) return <span>{translateGenreName(genres[0]!)}</span>;

  const remaining = genres.slice(1);

  return (
    <span className="inline-flex items-center gap-1">
      <span>{translateGenreName(genres[0]!)}</span>
      <Popover>
        <PopoverTrigger
          openOnHover
          delay={0}
          closeDelay={300}
          className="text-muted-foreground/70 hover:text-muted-foreground cursor-default transition-colors"
          aria-label={`${remaining.length} more genre${remaining.length > 1 ? "s" : ""}`}
        >
          +{remaining.length}
        </PopoverTrigger>
        <PopoverContent className="flex w-auto max-w-48 min-w-28 flex-col gap-0 p-1">
          {remaining.map((genre) => (
            <span key={genre} className="text-popover-foreground px-2 py-1 text-[13px]">
              {translateGenreName(genre)}
            </span>
          ))}
        </PopoverContent>
      </Popover>
    </span>
  );
}
