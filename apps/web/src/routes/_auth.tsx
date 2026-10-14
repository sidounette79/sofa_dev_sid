import { createFileRoute, Outlet } from "@tanstack/react-router";

import { authClient } from "@/lib/auth/client";
import { redirectToHomePage } from "@/lib/home-page-redirect";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession();
    if (session) redirectToHomePage();
  },
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <main className="min-h-screen">
      <div className="flex min-h-[80vh] items-center justify-center px-4">
        <Outlet />
      </div>
    </main>
  );
}
