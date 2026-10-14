import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import {
  clearAllTables,
  insertPlatform,
  insertTitleAvailability,
  insertEpisodeWatch,
  insertStatus,
  insertTitle,
  insertTvShow,
  insertUser,
} from "@sofa/test/db";

import { getUpcomingFeed } from "../src/discovery";

const TEST_NOW = new Date("2026-03-01T12:00:00Z");

beforeAll(() => {
  // See discovery.test.ts — faking only Date leaves node-postgres's own
  // timer-based scheduling alone (faking it too silently stalls real
  // queries).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

function daysFromNow(offset: number): string {
  const d = new Date(TEST_NOW);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

beforeEach(async () => {
  await clearAllTables();
  await insertUser();
});

// ── Basic feed ──────────────────────────────────────────────────────

describe("getUpcomingFeed", () => {
  test("returns upcoming episodes for tracked shows", async () => {
    const tomorrow = daysFromNow(1);
    await insertTvShow("tv-1", 100, 1, 2, {
      title: "Breaking Bad",
      airDates: [tomorrow, tomorrow],
    });
    await insertStatus("user-1", "tv-1", "in_progress");

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].titleName).toBe("Breaking Bad");
    expect(result.items[0].titleType).toBe("tv");
    expect(result.items[0].date).toBe(tomorrow);
  });

  test("returns upcoming movies for tracked titles", async () => {
    const nextWeek = daysFromNow(5);
    await insertTitle({ id: "m1", tmdbId: 1, type: "movie", title: "Dune 3", releaseDate: nextWeek });
    await insertStatus("user-1", "m1", "watchlist");

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].titleName).toBe("Dune 3");
    expect(result.items[0].titleType).toBe("movie");
    expect(result.items[0].date).toBe(nextWeek);
  });

  test("includes items airing today", async () => {
    const today = daysFromNow(0);
    await insertTvShow("tv-1", 100, 1, 1, { airDates: [today] });
    await insertStatus("user-1", "tv-1", "in_progress");

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].date).toBe(today);
  });

  test("excludes items beyond the days window", async () => {
    const farFuture = daysFromNow(91);
    await insertTvShow("tv-1", 100, 1, 1, { airDates: [farFuture] });
    await insertStatus("user-1", "tv-1", "in_progress");

    const result = await getUpcomingFeed("user-1", { days: 90 });
    expect(result.items).toHaveLength(0);
  });

  test("excludes titles not in user's library", async () => {
    const tomorrow = daysFromNow(1);
    await insertTvShow("tv-1", 100, 1, 1, { airDates: [tomorrow] });
    // No insertStatus — not tracked

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items).toHaveLength(0);
  });

  test("returns empty when no upcoming items", async () => {
    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });
});

// ── Sorting ─────────────────────────────────────────────────────────

describe("sorting", () => {
  test("sorts by date ascending, then title name", async () => {
    const day1 = daysFromNow(1);
    const day2 = daysFromNow(2);

    await insertTvShow("tv-z", 101, 1, 1, { title: "Zebra Show", airDates: [day1] });
    await insertTvShow("tv-a", 102, 1, 1, { title: "Alpha Show", airDates: [day2] });
    await insertTvShow("tv-b", 103, 1, 1, { title: "Alpha Show 2", airDates: [day1] });
    await insertStatus("user-1", "tv-z", "in_progress");
    await insertStatus("user-1", "tv-a", "in_progress");
    await insertStatus("user-1", "tv-b", "in_progress");

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items.map((i) => i.titleName)).toEqual([
      "Alpha Show 2",
      "Zebra Show",
      "Alpha Show",
    ]);
  });

  test("merges movies and episodes in date order", async () => {
    const day1 = daysFromNow(1);
    const day2 = daysFromNow(2);

    await insertTitle({ id: "m1", tmdbId: 1, type: "movie", title: "A Movie", releaseDate: day2 });
    await insertTvShow("tv-1", 100, 1, 1, { title: "A Show", airDates: [day1] });
    await insertStatus("user-1", "m1", "watchlist");
    await insertStatus("user-1", "tv-1", "in_progress");

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items[0].titleType).toBe("tv");
    expect(result.items[1].titleType).toBe("movie");
  });
});

// ── Batch collapse ──────────────────────────────────────────────────

describe("batch collapse", () => {
  test("collapses 3+ same-day episodes from the same title", async () => {
    const tomorrow = daysFromNow(1);
    await insertTvShow("tv-1", 100, 1, 4, {
      title: "Batch Show",
      airDates: [tomorrow, tomorrow, tomorrow, tomorrow],
    });
    await insertStatus("user-1", "tv-1", "in_progress");

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].episodeCount).toBe(4);
    expect(result.items[0].episodeName).toBeNull();
  });

  test("does not collapse fewer than 3 same-day episodes", async () => {
    const tomorrow = daysFromNow(1);
    await insertTvShow("tv-1", 100, 1, 2, {
      title: "Small Drop",
      airDates: [tomorrow, tomorrow],
    });
    await insertStatus("user-1", "tv-1", "in_progress");

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items).toHaveLength(2);
    expect(result.items[0].episodeCount).toBe(1);
    expect(result.items[0].episodeName).toBe("S1E1");
  });

  test("does not collapse episodes on different dates", async () => {
    const day1 = daysFromNow(1);
    const day2 = daysFromNow(2);
    const day3 = daysFromNow(3);
    await insertTvShow("tv-1", 100, 1, 3, {
      title: "Spread Show",
      airDates: [day1, day2, day3],
    });
    await insertStatus("user-1", "tv-1", "in_progress");

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items).toHaveLength(3);
  });
});

// ── Cursor pagination ───────────────────────────────────────────────

describe("cursor pagination", () => {
  test("paginates with limit and returns nextCursor", async () => {
    const day1 = daysFromNow(1);
    const day2 = daysFromNow(2);
    const day3 = daysFromNow(3);

    await insertTvShow("tv-a", 101, 1, 1, { title: "Show A", airDates: [day1] });
    await insertTvShow("tv-b", 102, 1, 1, { title: "Show B", airDates: [day2] });
    await insertTvShow("tv-c", 103, 1, 1, { title: "Show C", airDates: [day3] });
    await insertStatus("user-1", "tv-a", "in_progress");
    await insertStatus("user-1", "tv-b", "in_progress");
    await insertStatus("user-1", "tv-c", "in_progress");

    const page1 = await getUpcomingFeed("user-1", { days: 7, limit: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].titleName).toBe("Show A");
    expect(page1.items[1].titleName).toBe("Show B");
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await getUpcomingFeed("user-1", {
      days: 7,
      limit: 2,
      cursor: page1.nextCursor!,
    });
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0].titleName).toBe("Show C");
    expect(page2.nextCursor).toBeNull();
  });

  test("handles invalid cursor gracefully", async () => {
    const tomorrow = daysFromNow(1);
    await insertTvShow("tv-1", 100, 1, 1, { airDates: [tomorrow] });
    await insertStatus("user-1", "tv-1", "in_progress");

    const result = await getUpcomingFeed("user-1", { days: 7, cursor: "not-valid-base64!" });
    expect(result.items).toHaveLength(1);
  });
});

// ── isNewSeason ─────────────────────────────────────────────────────

describe("isNewSeason", () => {
  test("marks episode 1 as new season for caught_up shows", async () => {
    const yesterday = daysFromNow(-1);
    const tomorrow = daysFromNow(1);
    // 2 seasons, 1 ep each; S1E1 aired yesterday, S2E1 airs tomorrow
    const { episodeIds } = await insertTvShow("tv-1", 100, 2, 1, {
      title: "Returning Show",
      airDates: [yesterday, tomorrow],
      status: "Returning Series",
    });
    await insertStatus("user-1", "tv-1", "in_progress");
    // Watch S1E1 (the only aired episode) → caught_up display status
    await insertEpisodeWatch("user-1", episodeIds[0]);

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].isNewSeason).toBe(true);
  });

  test("does not mark non-episode-1 as new season", async () => {
    const yesterday = daysFromNow(-1);
    const tomorrow = daysFromNow(1);
    // 1 season, 3 episodes — ep 1 aired yesterday, ep 2 and 3 air tomorrow
    const { episodeIds } = await insertTvShow("tv-1", 100, 1, 3, {
      title: "Mid Show",
      airDates: [yesterday, tomorrow, tomorrow],
      status: "Returning Series",
    });
    await insertStatus("user-1", "tv-1", "in_progress");
    // Watch ep 1 (only aired episode) → caught_up
    await insertEpisodeWatch("user-1", episodeIds[0]);

    const result = await getUpcomingFeed("user-1", { days: 7 });
    // episodes 2 and 3 air tomorrow (not collapsed since only 2)
    expect(result.items.every((i) => i.isNewSeason === false)).toBe(true);
  });

  test("does not mark episode 1 as new season for watching shows", async () => {
    const yesterday = daysFromNow(-1);
    const tomorrow = daysFromNow(1);
    // 2 seasons, 1 ep each; S1E1 aired yesterday, S2E1 airs tomorrow
    await insertTvShow("tv-1", 100, 2, 1, {
      airDates: [yesterday, tomorrow],
      status: "Returning Series",
    });
    await insertStatus("user-1", "tv-1", "in_progress");
    // No episodes watched → display status is "watching", not "caught_up"

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].isNewSeason).toBe(false);
  });
});

// ── Streaming provider ──────────────────────────────────────────────

describe("streaming provider", () => {
  test("attaches flatrate streaming provider", async () => {
    const tomorrow = daysFromNow(1);
    await insertTvShow("tv-1", 100, 1, 1, { airDates: [tomorrow] });
    await insertStatus("user-1", "tv-1", "in_progress");
    const pId = await insertPlatform({ id: "p-netflix", name: "Netflix", tmdbProviderId: 8 });
    await insertTitleAvailability("tv-1", pId, { offerType: "flatrate" });

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items[0].streamingProvider).toEqual({
      platformId: "p-netflix",
      providerName: "Netflix",
      logoPath: "/logo.png",
    });
  });

  test("attaches ads-supported streaming provider", async () => {
    const tomorrow = daysFromNow(1);
    await insertTvShow("tv-1", 100, 1, 1, { airDates: [tomorrow] });
    await insertStatus("user-1", "tv-1", "in_progress");
    const pId = await insertPlatform({ id: "p-tubi", name: "Tubi", tmdbProviderId: 73 });
    await insertTitleAvailability("tv-1", pId, { offerType: "ads" });

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items[0].streamingProvider).toEqual({
      platformId: "p-tubi",
      providerName: "Tubi",
      logoPath: "/logo.png",
    });
  });

  test("prefers flatrate over ads when both exist", async () => {
    const tomorrow = daysFromNow(1);
    await insertTvShow("tv-1", 100, 1, 1, { airDates: [tomorrow] });
    await insertStatus("user-1", "tv-1", "in_progress");
    const pAds = await insertPlatform({ id: "p-tubi", name: "Tubi", tmdbProviderId: 73 });
    const pFlat = await insertPlatform({ id: "p-netflix", name: "Netflix", tmdbProviderId: 8 });
    await insertTitleAvailability("tv-1", pAds, { offerType: "ads" });
    await insertTitleAvailability("tv-1", pFlat, { offerType: "flatrate" });

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items[0].streamingProvider!.platformId).toBe("p-netflix");
  });

  test("returns null when only purchase providers exist", async () => {
    const tomorrow = daysFromNow(1);
    await insertTvShow("tv-1", 100, 1, 1, { airDates: [tomorrow] });
    await insertStatus("user-1", "tv-1", "in_progress");
    const pId = await insertPlatform({ id: "p-rent", tmdbProviderId: 99 });
    await insertTitleAvailability("tv-1", pId, { offerType: "rent" });

    const result = await getUpcomingFeed("user-1", { days: 7 });
    expect(result.items[0].streamingProvider).toBeNull();
  });
});
