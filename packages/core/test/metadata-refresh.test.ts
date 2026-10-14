import { beforeEach, describe, expect, test, vi } from "vitest";

import { episodes, seasons, titles } from "@sofa/db/schema";
import { clearAllTables, eq, insertTitle, testDb } from "@sofa/test/db";

interface MockSeasonEpisode {
  episode_number: number;
  name: string | null;
  overview: string | null;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
}

interface MockSeasonDetails {
  season_number: number;
  name: string | null;
  overview: string | null;
  poster_path: string | null;
  air_date: string | null;
  episodes: MockSeasonEpisode[];
}

const defaultSeasonDetails: MockSeasonDetails = {
  season_number: 1,
  name: "Season 1",
  overview: null,
  poster_path: "/new-season.png",
  air_date: null,
  episodes: [
    {
      episode_number: 1,
      name: "Episode 1",
      overview: null,
      still_path: "/new-still.png",
      air_date: null,
      runtime: null,
    },
  ],
};

const { mockGetTvSeasonDetails } = vi.hoisted(() => ({
  mockGetTvSeasonDetails: vi.fn(),
}));

vi.mock("@sofa/tmdb/client", () => ({
  getMovieDetails: async () => {
    throw new Error("not used");
  },
  getRecommendations: async () => ({ results: [] }),
  getSimilar: async () => ({ results: [] }),
  getTvDetails: async () => {
    throw new Error("not used");
  },
  getTvSeasonDetails: mockGetTvSeasonDetails,
  getVideos: async () => ({ results: [] }),
}));

import { refreshTvChildren, updateTitleWithArtInvalidation } from "../src/metadata";

beforeEach(async () => {
  await clearAllTables();
  mockGetTvSeasonDetails.mockImplementation(async () => ({
    ...defaultSeasonDetails,
    episodes: [...defaultSeasonDetails.episodes],
  }));
});

describe("refreshTvChildren", () => {
  test("clears stale season and episode thumbhashes when artwork paths change", async () => {
    await insertTitle({ id: "tv-1", tmdbId: 10, type: "tv", title: "Show" });
    await testDb.insert(seasons).values({
      id: "season-1",
      titleId: "tv-1",
      seasonNumber: 1,
      posterPath: "/old-season.png",
      posterThumbHash: "stale-season-hash",
    });
    await testDb.insert(episodes).values({
      id: "episode-1",
      seasonId: "season-1",
      episodeNumber: 1,
      stillPath: "/old-still.png",
      stillThumbHash: "stale-episode-hash",
    });

    await refreshTvChildren("tv-1", 10, 1);

    const [season] = await testDb.select().from(seasons).where(eq(seasons.id, "season-1"));
    const [episode] = await testDb.select().from(episodes).where(eq(episodes.id, "episode-1"));

    expect(season?.posterPath).toBe("/new-season.png");
    expect(season?.posterThumbHash).toBeNull();
    expect(episode?.stillPath).toBe("/new-still.png");
    expect(episode?.stillThumbHash).toBeNull();
  });

  test("clears an episode thumbhash when the still disappears", async () => {
    await insertTitle({ id: "tv-1", tmdbId: 10, type: "tv", title: "Show" });
    await testDb.insert(seasons).values({
      id: "season-1",
      titleId: "tv-1",
      seasonNumber: 1,
      posterPath: "/season.png",
    });
    await testDb.insert(episodes).values({
      id: "episode-1",
      seasonId: "season-1",
      episodeNumber: 1,
      stillPath: "/old-still.png",
      stillThumbHash: "stale-episode-hash",
    });

    mockGetTvSeasonDetails.mockImplementation(async () => ({
      ...defaultSeasonDetails,
      poster_path: "/season.png",
      episodes: [
        {
          episode_number: 1,
          name: "Episode 1",
          overview: null,
          still_path: null,
          air_date: null,
          runtime: null,
        },
      ],
    }));

    await refreshTvChildren("tv-1", 10, 1);

    const [episode] = await testDb.select().from(episodes).where(eq(episodes.id, "episode-1"));

    expect(episode?.stillPath).toBeNull();
    expect(episode?.stillThumbHash).toBeNull();
  });
});

describe("updateTitleWithArtInvalidation", () => {
  test("clears stale title hashes and palette when artwork changes", async () => {
    await testDb.insert(titles).values({
      id: "movie-1",
      tmdbId: 20,
      type: "movie",
      title: "Movie",
      posterPath: "/old-poster.png",
      posterThumbHash: "stale-poster-hash",
      backdropPath: "/old-backdrop.png",
      backdropThumbHash: "stale-backdrop-hash",
      colorPalette: JSON.stringify({ vibrant: "#fff" }),
      lastFetchedAt: new Date(),
    });

    const [existing] = await testDb.select().from(titles).where(eq(titles.id, "movie-1"));

    expect(existing).not.toBeUndefined();
    if (!existing) {
      throw new Error("Expected seeded title row");
    }

    await updateTitleWithArtInvalidation(existing, {
      posterPath: "/new-poster.png",
      backdropPath: "/new-backdrop.png",
    });

    const [title] = await testDb.select().from(titles).where(eq(titles.id, "movie-1"));

    expect(title?.posterPath).toBe("/new-poster.png");
    expect(title?.backdropPath).toBe("/new-backdrop.png");
    expect(title?.posterThumbHash).toBeNull();
    expect(title?.backdropThumbHash).toBeNull();
    expect(title?.colorPalette).toBeNull();
  });
});
