import { beforeEach, describe, expect, test } from "vitest";

import { personFilmography, persons } from "@sofa/db/schema";
import { clearAllTables, insertTitle, testDb } from "@sofa/test/db";

import { getLocalFilmography } from "../src/person";

beforeEach(async () => {
  await clearAllTables();
});

async function insertPerson(id: string, tmdbId: number, name: string) {
  await testDb.insert(persons).values({ id, tmdbId, name });
  return id;
}

async function insertFilmographyEntry(
  titleId: string,
  personId: string,
  overrides: {
    character?: string | null;
    department?: string;
    job?: string | null;
    displayOrder?: number;
  } = {},
) {
  await testDb.insert(personFilmography).values({
    titleId,
    personId,
    character: overrides.character ?? "Character",
    department: overrides.department ?? "Acting",
    job: overrides.job ?? null,
    displayOrder: overrides.displayOrder ?? 0,
  });
}

describe("getLocalFilmography", () => {
  test("returns filmography for a person", async () => {
    await insertTitle({ id: "m1", tmdbId: 1, title: "Movie One" });
    await insertTitle({ id: "m2", tmdbId: 2, title: "Movie Two" });
    await insertPerson("p1", 100, "Test Actor");
    await insertFilmographyEntry("m1", "p1", { character: "Hero" });
    await insertFilmographyEntry("m2", "p1", { character: "Sidekick" });

    const filmography = await getLocalFilmography("p1");
    expect(filmography).toHaveLength(2);
    expect(filmography.map((f) => f.title).sort()).toEqual(["Movie One", "Movie Two"]);
  });

  test("includes crew roles", async () => {
    await insertTitle({ id: "m1", tmdbId: 1, title: "Directed Movie" });
    await insertPerson("p1", 100, "Director Person");
    await insertFilmographyEntry("m1", "p1", {
      character: null,
      department: "Directing",
      job: "Director",
    });

    const filmography = await getLocalFilmography("p1");
    expect(filmography).toHaveLength(1);
    expect(filmography[0].department).toBe("Directing");
    expect(filmography[0].job).toBe("Director");
  });

  test("returns empty for person with no credits", async () => {
    await insertPerson("p1", 100, "Unknown Actor");
    const filmography = await getLocalFilmography("p1");
    expect(filmography).toHaveLength(0);
  });

  test("returns correct title types", async () => {
    await insertTitle({ id: "m1", tmdbId: 1, type: "movie", title: "A Movie" });
    await insertTitle({ id: "tv1", tmdbId: 2, type: "tv", title: "A Show" });
    await insertPerson("p1", 100, "Versatile Actor");
    await insertFilmographyEntry("m1", "p1");
    await insertFilmographyEntry("tv1", "p1");

    const filmography = await getLocalFilmography("p1");
    const types = filmography.map((f) => f.type).sort();
    expect(types).toEqual(["movie", "tv"]);
  });
});
