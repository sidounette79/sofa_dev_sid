// 26.08, Sid — real bug found live: genre names come straight from TMDB's
// genres table, fetched/stored in English, and were never translated
// anywhere they're displayed (title detail page's "Drama +1", the Stats
// "Genres regardés" list, library/discover filter dropdowns). TMDB's genre
// list is a small, fixed, well-known set (~19 movie + ~16 TV, overlapping),
// so a plain lookup here is simpler and more reliable than routing runtime
// DB strings through Lingui's extraction — unmapped names fall back to the
// original English string rather than showing blank.
const GENRE_NAMES_FR: Record<string, string> = {
  Action: "Action",
  Adventure: "Aventure",
  "Action & Adventure": "Action & Aventure",
  Animation: "Animation",
  Comedy: "Comédie",
  Crime: "Crime",
  Documentary: "Documentaire",
  Drama: "Drame",
  Family: "Familial",
  Fantasy: "Fantastique",
  History: "Histoire",
  Horror: "Horreur",
  Kids: "Enfants",
  Music: "Musique",
  Mystery: "Mystère",
  News: "Actualités",
  Reality: "Télé-réalité",
  Romance: "Romance",
  "Sci-Fi & Fantasy": "Science-Fiction & Fantastique",
  "Science Fiction": "Science-Fiction",
  Soap: "Feuilleton",
  Talk: "Talk-show",
  "TV Movie": "Téléfilm",
  Thriller: "Thriller",
  War: "Guerre",
  "War & Politics": "Guerre & Politique",
  Western: "Western",
};

export function translateGenreName(name: string): string {
  return GENRE_NAMES_FR[name] ?? name;
}
