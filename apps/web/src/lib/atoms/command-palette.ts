import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

export const commandPaletteOpenAtom = atom(false);
export const helpOpenAtom = atom(false);

const RECENT_KEY = "sofa:recent-searches";
// 18.10, Sid: "garder en mémoire les 10 derniers textes de recherche" (was 5).
export const MAX_RECENT = 10;
export const recentSearchesAtom = atomWithStorage<string[]>(RECENT_KEY, []);
