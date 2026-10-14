export interface AccentPreset {
  id: string;
  name: string;
  swatch: string;
  primary: string;
  ring: string;
  sidebarPrimary: string;
  sidebarRing: string;
  primaryForeground: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "amber", name: "Amber", swatch: "oklch(0.8 0.14 65)", primary: "oklch(0.8 0.14 65)", ring: "oklch(0.8 0.14 65)", sidebarPrimary: "oklch(0.8 0.14 65)", sidebarRing: "oklch(0.8 0.14 65)", primaryForeground: "oklch(0.13 0.006 55)" },
  { id: "rose", name: "Rose", swatch: "oklch(0.72 0.19 15)", primary: "oklch(0.72 0.19 15)", ring: "oklch(0.72 0.19 15)", sidebarPrimary: "oklch(0.72 0.19 15)", sidebarRing: "oklch(0.72 0.19 15)", primaryForeground: "oklch(0.13 0.006 55)" },
  { id: "violet", name: "Violet", swatch: "oklch(0.72 0.19 300)", primary: "oklch(0.72 0.19 300)", ring: "oklch(0.72 0.19 300)", sidebarPrimary: "oklch(0.72 0.19 300)", sidebarRing: "oklch(0.72 0.19 300)", primaryForeground: "oklch(0.13 0.006 55)" },
  { id: "emerald", name: "Emerald", swatch: "oklch(0.75 0.16 155)", primary: "oklch(0.75 0.16 155)", ring: "oklch(0.75 0.16 155)", sidebarPrimary: "oklch(0.75 0.16 155)", sidebarRing: "oklch(0.75 0.16 155)", primaryForeground: "oklch(0.13 0.006 55)" },
  { id: "sky", name: "Sky", swatch: "oklch(0.75 0.13 230)", primary: "oklch(0.75 0.13 230)", ring: "oklch(0.75 0.13 230)", sidebarPrimary: "oklch(0.75 0.13 230)", sidebarRing: "oklch(0.75 0.13 230)", primaryForeground: "oklch(0.13 0.006 55)" },
];

const ACCENT_STORAGE_KEY = "sofa:accent";
const GRID_COLUMNS_STORAGE_KEY = "sofa:grid-columns";
const MIN_GRID_COLUMNS = 3;
const MAX_GRID_COLUMNS = 8;
const DEFAULT_GRID_COLUMNS = 5;

export function getPersistedAccent(): string {
  const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
  if (stored && ACCENT_PRESETS.some((p) => p.id === stored)) return stored;
  return "amber";
}

export function applyAccent(id: string): void {
  const preset = ACCENT_PRESETS.find((p) => p.id === id) ?? ACCENT_PRESETS[0];
  const root = document.documentElement;
  root.style.setProperty("--primary", preset.primary);
  root.style.setProperty("--ring", preset.ring);
  root.style.setProperty("--sidebar-primary", preset.sidebarPrimary);
  root.style.setProperty("--sidebar-ring", preset.sidebarRing);
  root.style.setProperty("--primary-foreground", preset.primaryForeground);
}

export function setPersistedAccent(id: string): void {
  localStorage.setItem(ACCENT_STORAGE_KEY, id);
  applyAccent(id);
}

export function getPersistedGridColumns(): number {
  const stored = Number(localStorage.getItem(GRID_COLUMNS_STORAGE_KEY));
  if (stored >= MIN_GRID_COLUMNS && stored <= MAX_GRID_COLUMNS) return stored;
  return DEFAULT_GRID_COLUMNS;
}

export function applyGridColumns(count: number): void {
  document.documentElement.style.setProperty("--title-grid-columns", String(count));
}

export function setPersistedGridColumns(count: number): void {
  localStorage.setItem(GRID_COLUMNS_STORAGE_KEY, String(count));
  applyGridColumns(count);
}

let initialized = false;
export function initAppearance(): void {
  if (initialized) return;
  initialized = true;
  applyAccent(getPersistedAccent());
  applyGridColumns(getPersistedGridColumns());
}

const VIEW_MODE_STORAGE_KEY = "sofa:library-view-mode";

export type LibraryViewMode = "grid" | "list";

export function getPersistedViewMode(): LibraryViewMode {
  const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
  return stored === "list" ? "list" : "grid";
}

export function setPersistedViewMode(mode: LibraryViewMode): void {
  localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
}

const HOME_PAGE_STORAGE_KEY = "sofa:home-page";

export type HomePage = "library-tv" | "library-movie" | "explore" | "upcoming" | "statistics";

const HOME_PAGES: HomePage[] = ["library-tv", "library-movie", "explore", "upcoming", "statistics"];

// 17.09, Sid: "on peut offrir le choix de la page d'accueil aux gens?" — per
// browser/device like the other appearance prefs here (view mode, accent),
// not per-account: different people sharing the same login on different
// devices can each land somewhere else.
export function getPersistedHomePage(): HomePage {
  const stored = localStorage.getItem(HOME_PAGE_STORAGE_KEY);
  return HOME_PAGES.includes(stored as HomePage) ? (stored as HomePage) : "library-tv";
}

export function setPersistedHomePage(page: HomePage): void {
  localStorage.setItem(HOME_PAGE_STORAGE_KEY, page);
}

const SECTION_OPEN_STORAGE_KEY = "sofa:dashboard-sections-open";

function readSectionOpenMap(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem(SECTION_OPEN_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Whether a collapsible dashboard section (identified by a stable id) was left open or collapsed last time. */
export function getPersistedSectionOpen(id: string, defaultOpen: boolean): boolean {
  const map = readSectionOpenMap();
  return id in map ? map[id] : defaultOpen;
}

export function setPersistedSectionOpen(id: string, open: boolean): void {
  const map = readSectionOpenMap();
  map[id] = open;
  localStorage.setItem(SECTION_OPEN_STORAGE_KEY, JSON.stringify(map));
}
