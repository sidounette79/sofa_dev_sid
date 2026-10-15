import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { orpc, queryClient } from "@/lib/orpc/client";

import { routeTree } from "./routeTree.gen";

// 15.10, Sid: real crash confirmed live on Android, repeatedly, even after
// two targeted fixes (deferred query invalidation, keepMounted portals) -
// "Failed to execute 'removeChild'/'insertBefore' on 'Node': the node is
// not a child of this node". This is React's own commit colliding with
// something else (observed: a Base UI portal; likely not the only one)
// that already detached the node by the time React tries to. On a slow
// device the exact trigger keeps moving (before a dialog opens, while its
// data is loading, after a mutation succeeds) - chasing each occurrence
// individually hasn't converged. The operation React was about to perform
// was already redundant (the node is gone either way), so making it a
// no-op instead of throwing is safe - standard workaround for this
// specific DOM/React race, used elsewhere in production for the same
// reason. Keep the earlier fixes too; this is the backstop, not a
// replacement.
function reportNeutralizedDomMutation(op: "removeChild" | "insertBefore"): void {
  fetch("/api/client-error", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Neutralized mismatched ${op} (see main.tsx patch, 15.10)`,
      url: window.location.href,
      userAgent: navigator.userAgent,
    }),
  }).catch(() => undefined);
}

if (typeof Node === "function" && Node.prototype) {
  const originalRemoveChild = Node.prototype.removeChild;
  // @ts-expect-error - intentionally widening the signature to patch over the DOM race above
  Node.prototype.removeChild = function patchedRemoveChild(child) {
    if (child.parentNode !== this) {
      reportNeutralizedDomMutation("removeChild");
      return child;
    }
    return originalRemoveChild.call(this, child);
  };

  const originalInsertBefore = Node.prototype.insertBefore;
  // @ts-expect-error - intentionally widening the signature to patch over the DOM race above
  Node.prototype.insertBefore = function patchedInsertBefore(newNode, referenceNode) {
    if (referenceNode && referenceNode.parentNode !== this) {
      reportNeutralizedDomMutation("insertBefore");
      return newNode;
    }
    return originalInsertBefore.call(this, newNode, referenceNode);
  };
}

// Registered unconditionally on boot (cheap, standard PWA practice) — actual
// permission/subscription only happens when she opts in from Settings →
// Notifications.
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  defaultPreloadStaleTime: 60_000,
  defaultPendingMs: 0,
  scrollRestoration: true,
  context: { orpc, queryClient },
  Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  },
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
