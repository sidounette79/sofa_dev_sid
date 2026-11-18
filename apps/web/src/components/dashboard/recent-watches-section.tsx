import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useLingui } from "@lingui/react/macro";

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

export function RecentWatchesSection({ type }: { type: "movie" | "tv" }) {
  const { t } = useLingui();
  const { data, isLoading, isError } = useQuery(
    orpc.library.recentWatches.queryOptions({ input: { type, limit: 10 } }),
  );
  const items = data?.items ?? [];

  // 18.11 : la version precedente faisait `!isLoading && items.length === 0
  // -> null`, donc une requete EN ERREUR disparaissait exactement comme une
  // liste vide. Sid a vu les deux sections s'evaporer apres le chargement
  // sans le moindre message, alors que le serveur renvoyait un 500 a chaque
  // appel. Une erreur se dit, un vide s'efface - ce ne sont pas le meme cas.
  if (isError) {
    return (
      <section className="space-y-3">
        <h2 className="text-base font-semibold">
          {type === "tv" ? t`Last watched series` : t`Last watched films`}
        </h2>
        <p className="text-muted-foreground text-sm">{t`Could not load this list.`}</p>
      </section>
    );
  }

  // Une liste vide n'apprend rien et mangerait de la place: on s'efface.
  if (!isLoading && items.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">
        {type === "tv" ? t`Last watched series` : t`Last watched films`}
      </h2>
      <ol className="space-y-1.5">
        {items.map((item) => (
          <li key={item.titleId}>
            <Link
              to="/titles/$id"
              params={{ id: item.titleId }}
              className="hover:bg-muted/50 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors"
            >
              {item.posterPath ? (
                <img
                  src={item.posterPath}
                  alt=""
                  loading="lazy"
                  className="h-10 w-7 shrink-0 rounded object-cover"
                />
              ) : (
                <div className="bg-muted h-10 w-7 shrink-0 rounded" />
              )}
              <span className="min-w-0 flex-1 truncate text-sm">
                {item.name}
                {item.seasonNumber != null && item.episodeNumber != null && (
                  <span className="text-muted-foreground ml-1.5 text-xs tabular-nums">
                    S{String(item.seasonNumber).padStart(2, "0")}E
                    {String(item.episodeNumber).padStart(2, "0")}
                  </span>
                )}
              </span>
              <span className="text-muted-foreground shrink-0 text-xs">
                {relativeDay(new Date(item.watchedAt), t)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
