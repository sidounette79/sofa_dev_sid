import { createFileRoute, redirect } from "@tanstack/react-router";

import { LandingPage } from "@/components/landing-page";
import { authClient } from "@/lib/auth/client";
import { redirectToHomePage } from "@/lib/home-page-redirect";
import { client } from "@/lib/orpc/client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const [{ data: session }, info] = await Promise.all([
      authClient.getSession(),
      client.system.publicInfo({}),
    ]);
    if (session?.user) redirectToHomePage();
    if (!info.tmdbConfigured) throw redirect({ to: "/setup" });
    return { info };
  },
  component: IndexPage,
});

function IndexPage() {
  const { info } = Route.useRouteContext();
  return (
    <LandingPage
      posterUrls={info.posterUrls}
      freshInstall={info.userCount === 0}
      registrationOpen={info.registrationOpen}
    />
  );
}
