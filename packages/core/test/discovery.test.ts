import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

import {
  clearAllTables,
  insertPlatform,
  insertTitleAvailability,
  insertEpisodeWatch,
  insertMovieWatch,
  insertRating,
  insertRecommendation,
  insertStatus,
  insertTitle,
  insertTvShow,
  insertUser,
} from "@sofa/test/db";

import {
  getContinueWatchingFeed,
  getNewAvailableFeed,
  getRecommendationsFeed,
  getRecommendationsForTitle,
  getUserStats,
  getWatchCount,
  getWatchHistory,
} from "../src/discovery";

const TEST_NOW = new Date("2026-03-01T12:00:00Z");

beforeAll(() => {
  // 08.10, Patoune TV / Postgres migration: fake ONLY Date — faking
  // setTimeout/setImmediate too (vi.useFakeTimers()'s default) freezes the
  // internal scheduling node-postgres's connection pool relies on, which
  // silently stalled/short-circuited real queries here (empty results
  // instead of real ones, no error). SQLite's synchronous driver never hit
  // this since it never depended on those timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(TEST_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(async () => {
  await clearAllTables();
});

// ── getWatchCount ───────────────────────────────────────────────────

describe("getWatchCount", () => {
  test("counts movie watches within period", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1 });
    await insertTitle({ id: "m2", tmdbId: 2 });
    await insertMovieWatch("user-1", "m1");
    await insertMovieWatch("user-1", "m2");

    const count = await getWatchCount("user-1", "movies", "this_month");
    expect(count).toBe(2);
  });

  test("counts episode watches within period", async () => {
    await insertUser();
    const { episodeIds } = await insertTvShow();
    await insertEpisodeWatch("user-1", episodeIds[0]);
    await insertEpisodeWatch("user-1", episodeIds[1]);

    const count = await getWatchCount("user-1", "episodes", "this_week");
    expect(count).toBe(2);
  });

  test("excludes watches outside period", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1 });
    // Watch from 2 years ago
    const oldDate = new Date(TEST_NOW);
    oldDate.setFullYear(oldDate.getFullYear() - 2);
    await insertMovieWatch("user-1", "m1", oldDate);

    const count = await getWatchCount("user-1", "movies", "this_year");
    expect(count).toBe(0);
  });

  test("returns 0 when no watches exist", async () => {
    await insertUser();
    const count = await getWatchCount("user-1", "movies", "today");
    expect(count).toBe(0);
  });
});

// ── getWatchHistory ─────────────────────────────────────────────────

describe("getWatchHistory", () => {
  test("returns bucketed history with correct total count", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1 });
    await insertTitle({ id: "m2", tmdbId: 2 });
    await insertMovieWatch("user-1", "m1");
    await insertMovieWatch("user-1", "m2");

    const history = await getWatchHistory("user-1", "movies", "this_week");
    expect(history).toHaveLength(7);
    const totalCount = history.reduce((sum, b) => sum + b.count, 0);
    expect(totalCount).toBe(2);
  });

  test("returns all-zero buckets when no watches", async () => {
    await insertUser();
    const history = await getWatchHistory("user-1", "movies", "this_month");
    expect(history).toHaveLength(30);
    expect(history.every((b) => b.count === 0)).toBe(true);
  });

  test("returns correct bucket count for today period", async () => {
    await insertUser();
    const history = await getWatchHistory("user-1", "episodes", "today");
    expect(history).toHaveLength(24);
  });

  test("returns correct bucket count for this_year period", async () => {
    await insertUser();
    const history = await getWatchHistory("user-1", "movies", "this_year");
    expect(history).toHaveLength(12);
  });
});

// ── getUserStats ────────────────────────────────────────────────────

describe("getUserStats", () => {
  test("returns correct stats", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1 });
    await insertTitle({ id: "m2", tmdbId: 2 });
    const { titleId } = await insertTvShow("tv-1", 99999, 1, 3);

    await insertMovieWatch("user-1", "m1");
    await insertMovieWatch("user-1", "m2");
    await insertEpisodeWatch("user-1", "tv-1-s1e1");

    await insertStatus("user-1", "m1", "completed");
    await insertStatus("user-1", "m2", "completed");
    await insertStatus("user-1", titleId, "in_progress");

    const stats = await getUserStats("user-1");
    expect(stats.moviesThisMonth).toBe(2);
    expect(stats.episodesThisWeek).toBe(1);
    expect(stats.librarySize).toBe(3);
    expect(stats.completed).toBe(2);
  });

  test("returns zeros when no data", async () => {
    await insertUser();
    const stats = await getUserStats("user-1");
    expect(stats.moviesThisMonth).toBe(0);
    expect(stats.episodesThisWeek).toBe(0);
    expect(stats.librarySize).toBe(0);
    expect(stats.completed).toBe(0);
  });
});

// ── getContinueWatchingFeed ─────────────────────────────────────────

describe("getContinueWatchingFeed", () => {
  test("returns in-progress shows with next unwatched episode", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);
    await insertStatus("user-1", titleId, "in_progress");
    await insertEpisodeWatch("user-1", episodeIds[0]);

    const feed = await getContinueWatchingFeed("user-1");
    expect(feed).toHaveLength(1);
    expect(feed[0].title.id).toBe(titleId);
    expect(feed[0].nextEpisode?.episodeNumber).toBe(2);
    expect(feed[0].watchedEpisodes).toBe(1);
    expect(feed[0].totalEpisodes).toBe(3);
  });

  test("excludes completed shows", async () => {
    await insertUser();
    const { titleId } = await insertTvShow("tv-1", 99999, 1, 3);
    await insertStatus("user-1", titleId, "completed");

    const feed = await getContinueWatchingFeed("user-1");
    expect(feed).toHaveLength(0);
  });

  test("excludes movies", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1, type: "movie" });
    await insertStatus("user-1", "m1", "in_progress");

    const feed = await getContinueWatchingFeed("user-1");
    expect(feed).toHaveLength(0);
  });

  test("returns empty when no in-progress shows", async () => {
    await insertUser();
    const feed = await getContinueWatchingFeed("user-1");
    expect(feed).toHaveLength(0);
  });

  test("sorts by most recent watch", async () => {
    await insertUser();
    const show1 = await insertTvShow("tv-1", 11111, 1, 3);
    const show2 = await insertTvShow("tv-2", 22222, 1, 3);
    await insertStatus("user-1", show1.titleId, "in_progress");
    await insertStatus("user-1", show2.titleId, "in_progress");

    const older = new Date("2026-01-01");
    const newer = new Date("2026-03-01");
    await insertEpisodeWatch("user-1", show1.episodeIds[0], older);
    await insertEpisodeWatch("user-1", show2.episodeIds[0], newer);

    const feed = await getContinueWatchingFeed("user-1");
    expect(feed).toHaveLength(2);
    expect(feed[0].title.id).toBe("tv-2");
    expect(feed[1].title.id).toBe("tv-1");
  });

  test("skips show when all episodes are watched (no next episode)", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow("tv-1", 99999, 1, 2);
    await insertStatus("user-1", titleId, "in_progress");
    for (const epId of episodeIds) {
      await insertEpisodeWatch("user-1", epId);
    }

    const feed = await getContinueWatchingFeed("user-1");
    expect(feed).toHaveLength(0);
  });
});

// ── getNewAvailableFeed ─────────────────────────────────────────────

describe("getNewAvailableFeed", () => {
  test("returns titles with availability offers", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1 });
    await insertStatus("user-1", "m1", "watchlist");
    const pId = await insertPlatform({ id: "p-m1", tmdbProviderId: 8 });
    await insertTitleAvailability("m1", pId);

    const feed = await getNewAvailableFeed("user-1");
    expect(feed).toHaveLength(1);
    expect(feed[0].titleId).toBe("m1");
  });

  test("excludes titles without availability", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1 });
    await insertStatus("user-1", "m1", "watchlist");

    const feed = await getNewAvailableFeed("user-1");
    expect(feed).toHaveLength(0);
  });

  test("excludes titles not in user library", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1 });
    const pId = await insertPlatform({ id: "p-m1", tmdbProviderId: 8 });
    await insertTitleAvailability("m1", pId);

    const feed = await getNewAvailableFeed("user-1");
    expect(feed).toHaveLength(0);
  });
});

// ── getRecommendationsFeed ──────────────────────────────────────────

describe("getRecommendationsFeed", () => {
  test("returns recommendations from completed titles", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1, title: "Source Movie" });
    await insertTitle({ id: "m2", tmdbId: 2, title: "Recommended Movie" });
    await insertStatus("user-1", "m1", "completed");
    await insertRecommendation("m1", "m2", { rank: 1 });

    const feed = await getRecommendationsFeed("user-1");
    expect(feed).toHaveLength(1);
    expect(feed[0]?.id).toBe("m2");
  });

  test("returns recommendations from highly-rated titles", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1 });
    await insertTitle({ id: "m2", tmdbId: 2 });
    await insertStatus("user-1", "m1", "watchlist");
    await insertRating("user-1", "m1", 5);
    await insertRecommendation("m1", "m2", { rank: 1 });

    const feed = await getRecommendationsFeed("user-1");
    expect(feed).toHaveLength(1);
  });

  test("excludes already-tracked titles", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1 });
    await insertTitle({ id: "m2", tmdbId: 2 });
    await insertStatus("user-1", "m1", "completed");
    await insertStatus("user-1", "m2", "watchlist");
    await insertRecommendation("m1", "m2", { rank: 1 });

    const feed = await getRecommendationsFeed("user-1");
    expect(feed).toHaveLength(0);
  });

  test("returns empty when no source titles", async () => {
    await insertUser();
    const feed = await getRecommendationsFeed("user-1");
    expect(feed).toHaveLength(0);
  });

  test("scores higher when recommended by multiple sources", async () => {
    await insertUser();
    await insertTitle({ id: "m1", tmdbId: 1 });
    await insertTitle({ id: "m2", tmdbId: 2 });
    await insertTitle({ id: "m3", tmdbId: 3 });
    await insertTitle({ id: "rec1", tmdbId: 10, title: "Double Recommended" });
    await insertTitle({ id: "rec2", tmdbId: 20, title: "Single Recommended" });
    await insertStatus("user-1", "m1", "completed");
    await insertStatus("user-1", "m2", "completed");

    // rec1 recommended by both m1 and m2
    await insertRecommendation("m1", "rec1", { rank: 1 });
    await insertRecommendation("m2", "rec1", { rank: 1 });
    // rec2 recommended only by m1
    await insertRecommendation("m1", "rec2", { rank: 1 });

    const feed = await getRecommendationsFeed("user-1");
    expect(feed).toHaveLength(2);
    expect(feed[0]?.id).toBe("rec1");
  });
});

// ── getRecommendationsForTitle ──────────────────────────────────────

describe("getRecommendationsForTitle", () => {
  test("returns ordered recommendations for a title", async () => {
    await insertTitle({ id: "m1", tmdbId: 1 });
    await insertTitle({ id: "rec1", tmdbId: 10, title: "Rec One" });
    await insertTitle({ id: "rec2", tmdbId: 20, title: "Rec Two" });
    await insertRecommendation("m1", "rec1", { rank: 2 });
    await insertRecommendation("m1", "rec2", { rank: 1 });

    const recs = await getRecommendationsForTitle("m1");
    expect(recs).toHaveLength(2);
    expect(recs[0].title).toBe("Rec Two");
    expect(recs[1].title).toBe("Rec One");
  });

  test("returns empty for unknown title", async () => {
    const recs = await getRecommendationsForTitle("nonexistent");
    expect(recs).toHaveLength(0);
  });

  test("returns empty when no recommendations exist", async () => {
    await insertTitle({ id: "m1", tmdbId: 1 });
    const recs = await getRecommendationsForTitle("m1");
    expect(recs).toHaveLength(0);
  });

  test("deduplicates titles returned by multiple recommendation sources", async () => {
    await insertTitle({ id: "m1", tmdbId: 1 });
    await insertTitle({ id: "rec1", tmdbId: 10, title: "Rec One" });
    await insertTitle({ id: "rec2", tmdbId: 20, title: "Rec Two" });
    await insertRecommendation("m1", "rec1", {
      source: "tmdb_similar",
      rank: 1,
    });
    await insertRecommendation("m1", "rec1", {
      source: "tmdb_recommendations",
      rank: 2,
    });
    await insertRecommendation("m1", "rec2", {
      source: "tmdb_recommendations",
      rank: 3,
    });

    const recs = await getRecommendationsForTitle("m1");
    expect(recs).toHaveLength(2);
    expect(recs.map((rec) => rec.id)).toEqual(["rec1", "rec2"]);
  });
});
