import { redirect } from "@tanstack/react-router";

import { getPersistedHomePage } from "@/lib/appearance";

/** Redirects to whichever page the user picked as their home page (Appearance settings), defaulting to TV library. */
export function redirectToHomePage(): never {
  switch (getPersistedHomePage()) {
    case "library-movie":
      throw redirect({ to: "/library", search: { type: "movie" } });
    case "explore":
      throw redirect({ to: "/explore" });
    case "upcoming":
      throw redirect({ to: "/upcoming" });
    case "statistics":
      throw redirect({ to: "/statistics" });
    case "library-tv":
    default:
      throw redirect({ to: "/library", search: { type: "tv" } });
  }
}
