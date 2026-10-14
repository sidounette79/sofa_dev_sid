import { beforeEach, describe, expect, test } from "vitest";

import {
  userEpisodeWatches,
  userMovieWatches,
  userRatings,
  userTitleStatus,
} from "@sofa/db/schema";
import {
  and,
  clearAllTables,
  eq,
  insertTitle,
  insertTvShow,
  insertUser,
  testDb,
} from "@sofa/test/db";

import {
  getUserTitleInfo,
  logEpisodeWatch,
  logEpisodeWatchBatch,
  logMovieWatch,
  markAllEpisodesWatched,
  rateTitleStars,
  removeTitleStatus,
  setTitleStatus,
  unwatchEpisode,
  unwatchMovie,
  unwatchSeason,
  unwatchSeries,
} from "../src/tracking";

beforeEach(async () => {
  await clearAllTables();
});

// ── setTitleStatus ──────────────────────────────────────────────────

describe("setTitleStatus", () => {
  test("sets new status for a user/title pair", async () => {
    await insertUser();
    await insertTitle();
    await setTitleStatus("user-1", "title-1", "watchlist");

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "title-1")));
    expect(row?.status).toBe("watchlist");
  });

  test("updates existing status", async () => {
    await insertUser();
    await insertTitle();
    await setTitleStatus("user-1", "title-1", "watchlist");
    await setTitleStatus("user-1", "title-1", "in_progress");

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "title-1")));
    expect(row?.status).toBe("in_progress");
  });

  test("upsert: only one row per user/title", async () => {
    await insertUser();
    await insertTitle();
    await setTitleStatus("user-1", "title-1", "watchlist");
    await setTitleStatus("user-1", "title-1", "completed");

    const rows = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "title-1")));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("completed");
  });
});

// ── removeTitleStatus ───────────────────────────────────────────────

describe("removeTitleStatus", () => {
  test("removes existing status", async () => {
    await insertUser();
    await insertTitle();
    await setTitleStatus("user-1", "title-1", "watchlist");
    await removeTitleStatus("user-1", "title-1");

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "title-1")));
    expect(row).toBeUndefined();
  });

  test("no-op when status doesn't exist", async () => {
    await insertUser();
    await insertTitle();
    // Should not throw
    await removeTitleStatus("user-1", "title-1");
    expect(true).toBe(true);
  });
});

// ── logMovieWatch ───────────────────────────────────────────────────

describe("logMovieWatch", () => {
  test("inserts watch record", async () => {
    await insertUser();
    await insertTitle();
    await logMovieWatch("user-1", "title-1");

    const watches = await testDb
      .select()
      .from(userMovieWatches)
      .where(eq(userMovieWatches.userId, "user-1"));
    expect(watches).toHaveLength(1);
    expect(watches[0].titleId).toBe("title-1");
  });

  test("auto-sets status to completed when no prior status", async () => {
    await insertUser();
    await insertTitle();
    await logMovieWatch("user-1", "title-1");

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "title-1")));
    expect(row?.status).toBe("completed");
  });

  test("auto-upgrades watchlist to completed", async () => {
    await insertUser();
    await insertTitle();
    await setTitleStatus("user-1", "title-1", "watchlist");
    await logMovieWatch("user-1", "title-1");

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "title-1")));
    expect(row?.status).toBe("completed");
  });

  test("auto-upgrades in_progress to completed", async () => {
    await insertUser();
    await insertTitle();
    await setTitleStatus("user-1", "title-1", "in_progress");
    await logMovieWatch("user-1", "title-1");

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "title-1")));
    expect(row?.status).toBe("completed");
  });

  test("doesn't downgrade already-completed status", async () => {
    await insertUser();
    await insertTitle();
    await setTitleStatus("user-1", "title-1", "completed");
    await logMovieWatch("user-1", "title-1");

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "title-1")));
    expect(row?.status).toBe("completed");
  });
});

// ── logEpisodeWatch ─────────────────────────────────────────────────

describe("logEpisodeWatch", () => {
  test("inserts watch record", async () => {
    await insertUser();
    const { episodeIds } = await insertTvShow();
    await logEpisodeWatch("user-1", episodeIds[0]);

    const watches = await testDb
      .select()
      .from(userEpisodeWatches)
      .where(eq(userEpisodeWatches.userId, "user-1"));
    expect(watches).toHaveLength(1);
    expect(watches[0].episodeId).toBe(episodeIds[0]);
  });

  test("auto-sets status to in_progress", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow();
    await logEpisodeWatch("user-1", episodeIds[0]);

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("in_progress");
  });

  test("upgrades watchlist to in_progress", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow();
    await setTitleStatus("user-1", titleId, "watchlist");
    await logEpisodeWatch("user-1", episodeIds[0]);

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("in_progress");
  });

  test("doesn't downgrade completed to in_progress", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow();
    await setTitleStatus("user-1", titleId, "completed");
    await logEpisodeWatch("user-1", episodeIds[0]);

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("completed");
  });

  test("stays in_progress when all episodes are watched", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);

    for (const epId of episodeIds) {
      await logEpisodeWatch("user-1", epId);
    }

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("in_progress");
  });
});

// ── logEpisodeWatchBatch ────────────────────────────────────────────

describe("logEpisodeWatchBatch", () => {
  test("batch inserts multiple watches", async () => {
    await insertUser();
    const { episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);
    await logEpisodeWatchBatch("user-1", episodeIds.slice(0, 2));

    const watches = await testDb
      .select()
      .from(userEpisodeWatches)
      .where(eq(userEpisodeWatches.userId, "user-1"));
    expect(watches).toHaveLength(2);
  });

  test("sets in_progress status", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);
    await logEpisodeWatchBatch("user-1", [episodeIds[0]]);

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("in_progress");
  });

  test("stays in_progress if batch covers all episodes", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);
    await logEpisodeWatchBatch("user-1", episodeIds);

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("in_progress");
  });

  test("no-op for empty array", async () => {
    await insertUser();
    await logEpisodeWatchBatch("user-1", []);

    const watches = await testDb
      .select()
      .from(userEpisodeWatches)
      .where(eq(userEpisodeWatches.userId, "user-1"));
    expect(watches).toHaveLength(0);
  });
});

// ── markAllEpisodesWatched ──────────────────────────────────────────

describe("markAllEpisodesWatched", () => {
  test("marks all episodes as watched and sets in_progress", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);
    await markAllEpisodesWatched("user-1", titleId);

    const watches = await testDb
      .select()
      .from(userEpisodeWatches)
      .where(eq(userEpisodeWatches.userId, "user-1"));
    expect(watches).toHaveLength(episodeIds.length);

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("in_progress");
  });

  test("skips already-watched episodes (no duplicates)", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);

    // Watch first episode manually
    await logEpisodeWatch("user-1", episodeIds[0]);
    // Then mark all
    await markAllEpisodesWatched("user-1", titleId);

    // Should have exactly 3 episode watches (1 manual + 2 new), not 4
    const watches = await testDb
      .select()
      .from(userEpisodeWatches)
      .where(eq(userEpisodeWatches.userId, "user-1"));
    expect(watches).toHaveLength(3);
  });

  test("no-op for movies", async () => {
    await insertUser();
    await insertTitle({ id: "movie-1", type: "movie" });
    await markAllEpisodesWatched("user-1", "movie-1");

    const watches = await testDb
      .select()
      .from(userEpisodeWatches)
      .where(eq(userEpisodeWatches.userId, "user-1"));
    expect(watches).toHaveLength(0);
  });
});

// ── unwatchEpisode ──────────────────────────────────────────────────

describe("unwatchEpisode", () => {
  test("removes watch record", async () => {
    await insertUser();
    const { episodeIds } = await insertTvShow();
    await logEpisodeWatch("user-1", episodeIds[0]);
    await unwatchEpisode("user-1", episodeIds[0]);

    const watches = await testDb
      .select()
      .from(userEpisodeWatches)
      .where(eq(userEpisodeWatches.userId, "user-1"));
    expect(watches).toHaveLength(0);
  });

  test("keeps in_progress when some episodes remain watched", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);
    await markAllEpisodesWatched("user-1", titleId);

    // Unwatch one episode — still has 2 watched
    await unwatchEpisode("user-1", episodeIds[0]);

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("in_progress");
  });

  test("downgrades to watchlist when all episodes unwatched", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);

    // Watch one episode then unwatch it
    await logEpisodeWatch("user-1", episodeIds[0]);
    await unwatchEpisode("user-1", episodeIds[0]);

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("watchlist");
  });

  test("doesn't change in_progress status when episodes remain", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);
    await logEpisodeWatch("user-1", episodeIds[0]);
    await logEpisodeWatch("user-1", episodeIds[1]);

    // Status should be in_progress
    let [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("in_progress");

    await unwatchEpisode("user-1", episodeIds[0]);

    [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("in_progress");
  });
});

// ── unwatchSeason ───────────────────────────────────────────────────

describe("unwatchSeason", () => {
  test("removes all episode watches for a season", async () => {
    await insertUser();
    const { episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);
    for (const epId of episodeIds) {
      await logEpisodeWatch("user-1", epId);
    }

    await unwatchSeason("user-1", "tv-1-s1");

    const watches = await testDb
      .select()
      .from(userEpisodeWatches)
      .where(eq(userEpisodeWatches.userId, "user-1"));
    expect(watches).toHaveLength(0);
  });

  test("keeps in_progress when other seasons have watches", async () => {
    await insertUser();
    const { titleId } = await insertTvShow("tv-1", 99999, 2, 2);

    // Watch all episodes across both seasons
    await markAllEpisodesWatched("user-1", titleId);

    // Unwatch season 1 — season 2 still has watches
    await unwatchSeason("user-1", "tv-1-s1");

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("in_progress");
  });

  test("downgrades to watchlist when all episodes unwatched", async () => {
    await insertUser();
    const { titleId } = await insertTvShow("tv-1", 99999, 1, 2);

    await markAllEpisodesWatched("user-1", titleId);

    // Unwatch the only season — no episodes remain
    await unwatchSeason("user-1", "tv-1-s1");

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, titleId)));
    expect(row?.status).toBe("watchlist");
  });
});

// ── unwatchMovie ─────────────────────────────────────────────────────

describe("unwatchMovie", () => {
  test("removes movie watch records and reverts completed to watchlist", async () => {
    await insertUser();
    await insertTitle();
    await logMovieWatch("user-1", "title-1");

    // Verify completed status
    const [before] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "title-1")));
    expect(before?.status).toBe("completed");

    await unwatchMovie("user-1", "title-1");

    // Watch records removed
    const watches = await testDb
      .select()
      .from(userMovieWatches)
      .where(and(eq(userMovieWatches.userId, "user-1"), eq(userMovieWatches.titleId, "title-1")));
    expect(watches).toHaveLength(0);

    // Status reverted to watchlist
    const [after] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "title-1")));
    expect(after?.status).toBe("watchlist");
  });

  test("no-op when movie was not watched", async () => {
    await insertUser();
    await insertTitle();
    await setTitleStatus("user-1", "title-1", "watchlist");

    await unwatchMovie("user-1", "title-1");

    const [row] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "title-1")));
    expect(row?.status).toBe("watchlist");
  });
});

// ── unwatchSeries ────────────────────────────────────────────────────

describe("unwatchSeries", () => {
  test("removes all episode watches and reverts status to watchlist", async () => {
    const { episodeIds } = await insertTvShow("tv-1");
    await insertUser();
    await logEpisodeWatch("user-1", episodeIds[0]);
    await logEpisodeWatch("user-1", episodeIds[1]);

    const before = await testDb
      .select()
      .from(userEpisodeWatches)
      .where(eq(userEpisodeWatches.userId, "user-1"));
    expect(before.length).toBeGreaterThan(0);

    await unwatchSeries("user-1", "tv-1");

    const after = await testDb
      .select()
      .from(userEpisodeWatches)
      .where(eq(userEpisodeWatches.userId, "user-1"));
    expect(after).toHaveLength(0);

    const [statusRow] = await testDb
      .select()
      .from(userTitleStatus)
      .where(and(eq(userTitleStatus.userId, "user-1"), eq(userTitleStatus.titleId, "tv-1")));
    expect(statusRow?.status).toBe("watchlist");
  });
});

// ── rateTitleStars ───────────────────────────────────────────────────

describe("rateTitleStars", () => {
  test("sets rating", async () => {
    await insertUser();
    await insertTitle();
    await rateTitleStars("user-1", "title-1", 4);

    const [row] = await testDb
      .select()
      .from(userRatings)
      .where(and(eq(userRatings.userId, "user-1"), eq(userRatings.titleId, "title-1")));
    expect(row?.ratingStars).toBe(4);
  });

  test("updates existing rating", async () => {
    await insertUser();
    await insertTitle();
    await rateTitleStars("user-1", "title-1", 3);
    await rateTitleStars("user-1", "title-1", 5);

    const rows = await testDb
      .select()
      .from(userRatings)
      .where(and(eq(userRatings.userId, "user-1"), eq(userRatings.titleId, "title-1")));
    expect(rows).toHaveLength(1);
    expect(rows[0].ratingStars).toBe(5);
  });

  test("deletes rating when 0", async () => {
    await insertUser();
    await insertTitle();
    await rateTitleStars("user-1", "title-1", 4);
    await rateTitleStars("user-1", "title-1", 0);

    const [row] = await testDb
      .select()
      .from(userRatings)
      .where(and(eq(userRatings.userId, "user-1"), eq(userRatings.titleId, "title-1")));
    expect(row).toBeUndefined();
  });
});

// ── getUserTitleInfo ────────────────────────────────────────────────

describe("getUserTitleInfo", () => {
  test("returns status, rating, and watched episode IDs", async () => {
    await insertUser();
    const { titleId, episodeIds } = await insertTvShow("tv-1", 99999, 1, 3);
    await setTitleStatus("user-1", titleId, "in_progress");
    await rateTitleStars("user-1", titleId, 4);
    await logEpisodeWatch("user-1", episodeIds[0]);
    await logEpisodeWatch("user-1", episodeIds[1]);

    const info = await getUserTitleInfo("user-1", titleId);
    expect(info.status).toBe("in_progress");
    expect(info.rating).toBe(4);
    expect(info.episodeWatches).toHaveLength(2);
    expect(info.episodeWatches).toContain(episodeIds[0]);
    expect(info.episodeWatches).toContain(episodeIds[1]);
  });

  test("returns nulls when no data exists", async () => {
    await insertUser();
    await insertTitle();

    const info = await getUserTitleInfo("user-1", "title-1");
    expect(info.status).toBeNull();
    expect(info.rating).toBeNull();
    expect(info.episodeWatches).toHaveLength(0);
  });
});
