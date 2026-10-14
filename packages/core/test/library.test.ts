import { beforeAll, beforeEach, describe, expect, test } from "vitest";

import { clearAllTables, insertStatus, insertTitle, insertUser } from "@sofa/test/db";

import { getFilteredLibraryFeed, getLibraryGenresList } from "../src/library";

const defaultFilters = { sortBy: "added_at", sortDirection: "desc" as const, page: 1, limit: 20 };

beforeAll(async () => {
  await clearAllTables();
});
beforeEach(async () => {
  await clearAllTables();
});

// ── getFilteredLibraryFeed ─────────────────────────────────────────────

describe("getFilteredLibraryFeed", () => {
  test("returns first page with correct pagination metadata", async () => {
    await insertUser();
    await Promise.all(
      Array.from({ length: 25 }, async (_, idx) => {
        const i = idx + 1;
        await insertTitle({ id: `m${i}`, tmdbId: i });
        await insertStatus("user-1", `m${i}`, "watchlist");
      }),
    );

    const result = await getFilteredLibraryFeed("user-1", { ...defaultFilters });
    expect(result.items).toHaveLength(20);
    expect(result.page).toBe(1);
    expect(result.totalResults).toBe(25);
    expect(result.totalPages).toBe(2);
  });

  test("returns second page with remaining items", async () => {
    await insertUser();
    await Promise.all(
      Array.from({ length: 25 }, async (_, idx) => {
        const i = idx + 1;
        await insertTitle({ id: `m${i}`, tmdbId: i });
        await insertStatus("user-1", `m${i}`, "watchlist");
      }),
    );

    const result = await getFilteredLibraryFeed("user-1", { ...defaultFilters, page: 2 });
    expect(result.items).toHaveLength(5);
    expect(result.page).toBe(2);
    expect(result.totalResults).toBe(25);
    expect(result.totalPages).toBe(2);
  });

  test("custom limit respected", async () => {
    await insertUser();
    await Promise.all(
      Array.from({ length: 10 }, async (_, idx) => {
        const i = idx + 1;
        await insertTitle({ id: `m${i}`, tmdbId: i });
        await insertStatus("user-1", `m${i}`, "watchlist");
      }),
    );

    const result = await getFilteredLibraryFeed("user-1", { ...defaultFilters, limit: 5 });
    expect(result.items).toHaveLength(5);
    expect(result.totalPages).toBe(2);
    expect(result.totalResults).toBe(10);
  });

  test("empty page beyond total returns empty items", async () => {
    await insertUser();
    for (let i = 1; i <= 5; i++) {
      await insertTitle({ id: `m${i}`, tmdbId: i });
      await insertStatus("user-1", `m${i}`, "watchlist");
    }

    const result = await getFilteredLibraryFeed("user-1", { ...defaultFilters, page: 2 });
    expect(result.items).toHaveLength(0);
    expect(result.page).toBe(2);
  });

  test("pages are disjoint and cover all items", async () => {
    await insertUser();
    for (let i = 1; i <= 4; i++) {
      await insertTitle({ id: `m${i}`, tmdbId: i });
      await insertStatus("user-1", `m${i}`, "watchlist");
    }

    const page1 = await getFilteredLibraryFeed("user-1", { ...defaultFilters, limit: 2 });
    const page2 = await getFilteredLibraryFeed("user-1", { ...defaultFilters, page: 2, limit: 2 });

    expect(page1.items).toHaveLength(2);
    expect(page2.items).toHaveLength(2);

    const allTitleIds = new Set([
      ...page1.items.map((i) => i.titleId),
      ...page2.items.map((i) => i.titleId),
    ]);
    expect(allTitleIds.size).toBe(4);
  });

  test("filters by type", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1, type: "movie" });
    await insertTitle({ id: "t1", tmdbId: 2, type: "tv" });
    await insertStatus("user-1", "m1", "watchlist");
    await insertStatus("user-1", "t1", "watchlist");

    const movies = await getFilteredLibraryFeed("user-1", { ...defaultFilters, type: "movie" });
    expect(movies.items).toHaveLength(1);
    expect(movies.items[0]!.type).toBe("movie");

    const tv = await getFilteredLibraryFeed("user-1", { ...defaultFilters, type: "tv" });
    expect(tv.items).toHaveLength(1);
    expect(tv.items[0]!.type).toBe("tv");
  });

  test("filters by search text", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1, title: "The Matrix" });
    await insertTitle({ id: "m2", tmdbId: 2, title: "Inception" });
    await insertStatus("user-1", "m1", "watchlist");
    await insertStatus("user-1", "m2", "watchlist");

    const result = await getFilteredLibraryFeed("user-1", { ...defaultFilters, search: "matrix" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.title).toBe("The Matrix");
  });

  test("filters by status", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1 });
    await insertTitle({ id: "m2", tmdbId: 2 });
    await insertStatus("user-1", "m1", "watchlist");
    await insertStatus("user-1", "m2", "completed");

    const watchlist = await getFilteredLibraryFeed("user-1", {
      ...defaultFilters,
      statuses: ["in_watchlist"],
    });
    expect(watchlist.items).toHaveLength(1);

    const completed = await getFilteredLibraryFeed("user-1", {
      ...defaultFilters,
      statuses: ["completed"],
    });
    expect(completed.items).toHaveLength(1);
  });
});

// ── getLibraryGenresList ──────────────────────────────────────────────

describe("getLibraryGenresList", () => {
  test("returns empty array when user has no titles", async () => {
    await insertUser();
    const genres = await getLibraryGenresList("user-1");
    expect(genres).toEqual([]);
  });
});
