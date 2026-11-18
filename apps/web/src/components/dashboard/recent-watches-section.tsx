import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useLingui } from "@lingui/react/macro";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { orpc } from "@/lib/orpc/client";

/**
 * Les dix derniers titres vus, en liste compacte.
 *
 * 18.11, Sid : « on pourrait avoir, quelque part dans la page des series et
 * aussi des films, un resume des 10 derniers trucs vus ? Sous forme de
 * liste ? », puis, capture a l'appui, « on aurait de la place la, pour
 * mettre series et films cote a cote non ? Sans que ca decale rien et comme
 * ça on voit tout de suite ». D'ou le format: etroit, dense, pose a cote de
 * « En cours sur Emby » plutot qu'en pleine largeur.
 *
 * 18.11, sur telephone : « c'est chiant, sur le natel ca vient en dessous.
 * Est-ce que tu peux forcer les listes dans deux cases qui se mettraient a
 * cote de "en cours sur emby" et qui resteraient fixes et figees a droite ?
 * Sans passer en dessous ? Quitte a voir en tout petit et cliquer dessus
 * pour voir en grand ? » — d'ou `dense`, qui retrecit tout au point de
 * tenir dans une demi-colonne de telephone, et le clic qui rouvre la meme
 * liste en taille lisible.
 */
// Le nombre fait partie du message (« {days}d ago ») au lieu d'etre colle
// devant un fragment traduit: une langue qui place le nombre ailleurs, ou
// qui accorde, ne peut rien faire d'une concatenation.
function relativeDay(date: Date, t: ReturnType<typeof useLingui>["t"]): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return t`Today`;
  if (days === 1) return t`Yesterday`;
  if (days < 30) return t`${days}d ago`;
  return date.toLocaleDateString();
}

type Item = {
  titleId: string;
  name: string;
  watchedAt: string;
  seasonNumber: number | null;
  episodeNumber: number | null;
};

function EpisodeTag({ item, className }: { item: Item; className?: string }) {
  if (item.seasonNumber == null || item.episodeNumber == null) return null;
  return (
    <span className={`text-muted-foreground tabular-nums ${className ?? ""}`}>
      S{String(item.seasonNumber).padStart(2, "0")}E
      {String(item.episodeNumber).padStart(2, "0")}
    </span>
  );
}

/** La liste elle-meme, aux deux echelles. */
function WatchList({
  items,
  dense,
  t,
}: {
  items: Item[];
  dense: boolean;
  t: ReturnType<typeof useLingui>["t"];
}) {
  return (
    <ol className={dense ? "space-y-px" : "space-y-0.5"}>
      {items.map((item) => (
        <li key={item.titleId}>
          <Link
            to="/titles/$id"
            params={{ id: item.titleId }}
            className={
              dense
                ? "hover:bg-muted/50 flex flex-col rounded px-1 py-0.5 leading-tight transition-colors"
                : "hover:bg-muted/50 flex items-baseline gap-2 rounded-md px-2 py-1 transition-colors"
            }
          >
            {dense ? (
              <>
                {/* En colonne etroite, le titre et l'episode ne tiennent pas
                    sur une ligne: l'episode passe dessous plutot que de
                    rogner le titre, qui est la seule chose identifiable. */}
                <span className="truncate text-[11px]">{item.name}</span>
                <span className="flex items-baseline gap-1 text-[10px]">
                  <EpisodeTag item={item} />
                  <span className="text-muted-foreground/70 truncate">
                    {relativeDay(new Date(item.watchedAt), t)}
                  </span>
                </span>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {item.name}
                  <EpisodeTag item={item} className="ml-1.5 text-xs" />
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {relativeDay(new Date(item.watchedAt), t)}
                </span>
              </>
            )}
          </Link>
        </li>
      ))}
    </ol>
  );
}

export function RecentWatchesSection({
  type,
  dense = false,
}: {
  type: "movie" | "tv";
  dense?: boolean;
}) {
  const { t } = useLingui();
  const { data, isLoading, isError } = useQuery(
    orpc.library.recentWatches.queryOptions({ input: { type, limit: 10 } }),
  );
  const items = (data?.items ?? []) as Item[];
  const title = type === "tv" ? t`Last watched series` : t`Last watched films`;

  // 18.11 : la version precedente faisait `!isLoading && items.length === 0
  // -> null`, donc une requete EN ERREUR disparaissait exactement comme une
  // liste vide. Sid a vu les deux sections s'evaporer apres le chargement
  // sans le moindre message, alors que le serveur renvoyait un 500 a chaque
  // appel. Une erreur se dit, un vide s'efface - ce ne sont pas le meme cas.
  if (isError) {
    return (
      <section className="space-y-1.5">
        <h2 className={dense ? "text-[11px] font-semibold" : "text-sm font-semibold"}>
          {title}
        </h2>
        <p className="text-muted-foreground text-[11px]">{t`Could not load this list.`}</p>
      </section>
    );
  }

  // Une liste vide n'apprend rien et mangerait de la place: on s'efface.
  if (!isLoading && items.length === 0) return null;

  if (!dense) {
    return (
      <section className="space-y-1.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        <WatchList items={items} dense={false} t={t} />
      </section>
    );
  }

  return (
    <Dialog>
      <section className="min-w-0 space-y-1">
        <DialogTrigger asChild>
          <button
            type="button"
            className="hover:text-primary w-full truncate text-left text-[11px] font-semibold transition-colors"
            title={t`Tap to enlarge`}
          >
            {title}
          </button>
        </DialogTrigger>
        <WatchList items={items} dense t={t} />
      </section>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <WatchList items={items} dense={false} t={t} />
      </DialogContent>
    </Dialog>
  );
}
