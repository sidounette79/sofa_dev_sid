import { beforeEach, describe, expect, test, vi } from "vitest";

import { clearAllTables, insertTitle, insertUser } from "@sofa/test/db";

const { mockGetTvExternalIds } = vi.hoisted(() => ({
  mockGetTvExternalIds: vi.fn(
    (): Promise<{ tvdb_id: number | null; imdb_id: string | null }> =>
      Promise.resolve({ tvdb_id: null, imdb_id: null }),
  ),
}));

vi.mock("@sofa/tmdb/client", () => ({
  getTvExternalIds: mockGetTvExternalIds,
}));

const { mockLookupSeriesByTitle, mockAddSeries } = vi.hoisted(() => ({
  mockLookupSeriesByTitle: vi.fn(() => Promise.resolve<{ tvdbId: number; tmdbId?: number }[]>([])),
  mockAddSeries: vi.fn(() => Promise.resolve()),
}));

vi.mock("@sofa/sonarr/client", () => ({
  lookupSeriesByTitle: mockLookupSeriesByTitle,
  addSeries: mockAddSeries,
}));

import { requestSeries, MediaRequestError } from "../src/media-requests";

beforeEach(async () => {
  await clearAllTables();
  mockGetTvExternalIds.mockClear();
  mockLookupSeriesByTitle.mockClear();
  mockAddSeries.mockClear();
});

describe("requestSeries — Sonarr title-search fallback", () => {
  // 04.09, Sid — real case: TMDB's external_ids had a null tvdb_id for "The
  // One About Matthew Perry" (an unreleased documentary), but Sonarr's own
  // title lookup found it fine (TheTVDB has it, TMDB's cross-reference to it
  // just wasn't filled in yet). Jellyseerr could request it; Sofa couldn't,
  // until this fallback.
  test("falls back to Sonarr title search when TMDB has no TVDB ID", async () => {
    await insertUser("user-1");
    await insertTitle({
      id: "tv1",
      tmdbId: 333533,
      type: "tv",
      title: "The One About Matthew Perry",
    });

    mockGetTvExternalIds.mockResolvedValueOnce({ tvdb_id: null, imdb_id: null });
    mockLookupSeriesByTitle.mockResolvedValueOnce([
      { tvdbId: 482057, tmdbId: 333533, title: "The One About Matthew Perry" },
    ]);

    await requestSeries("user-1", "Sid", "tv1", {
      rootFolderPath: "/data/videos/SERIES CARBA",
      qualityProfileId: 4,
    });

    expect(mockLookupSeriesByTitle).toHaveBeenCalledWith("The One About Matthew Perry");
    expect(mockAddSeries).toHaveBeenCalledWith(
      expect.objectContaining({ tvdbId: 482057, rootFolderPath: "/data/videos/SERIES CARBA" }),
    );
  });

  test("ignores a Sonarr title-search result whose TMDB ID doesn't match", async () => {
    await insertUser("user-1");
    await insertTitle({ id: "tv1", tmdbId: 333533, type: "tv", title: "Ambiguous Title" });

    mockGetTvExternalIds.mockResolvedValueOnce({ tvdb_id: null, imdb_id: null });
    // A same-titled but unrelated show — must not be trusted just because the name matches.
    mockLookupSeriesByTitle.mockResolvedValueOnce([
      { tvdbId: 999999, tmdbId: 111111, title: "Ambiguous Title" },
    ]);

    await expect(
      requestSeries("user-1", "Sid", "tv1", {
        rootFolderPath: "/data/videos",
        qualityProfileId: 4,
      }),
    ).rejects.toThrow(MediaRequestError);
    expect(mockAddSeries).not.toHaveBeenCalled();
  });

  test("surfaces the original error when Sonarr title search itself fails", async () => {
    await insertUser("user-1");
    await insertTitle({ id: "tv1", tmdbId: 333533, type: "tv", title: "Flaky Show" });

    mockGetTvExternalIds.mockResolvedValueOnce({ tvdb_id: null, imdb_id: null });
    mockLookupSeriesByTitle.mockRejectedValueOnce(new Error("Sonarr API error: HTTP 500"));

    await expect(
      requestSeries("user-1", "Sid", "tv1", {
        rootFolderPath: "/data/videos",
        qualityProfileId: 4,
      }),
    ).rejects.toThrow(MediaRequestError);
    expect(mockAddSeries).not.toHaveBeenCalled();
  });

  test("does not fall back to Sonarr when TMDB already resolved a TVDB ID", async () => {
    await insertUser("user-1");
    await insertTitle({ id: "tv1", tmdbId: 300, type: "tv", title: "Show A" });

    mockGetTvExternalIds.mockResolvedValueOnce({ tvdb_id: 55555, imdb_id: "tt1234567" });

    await requestSeries("user-1", "Sid", "tv1", {
      rootFolderPath: "/data/videos",
      qualityProfileId: 4,
    });

    expect(mockLookupSeriesByTitle).not.toHaveBeenCalled();
    expect(mockAddSeries).toHaveBeenCalledWith(expect.objectContaining({ tvdbId: 55555 }));
  });
});
