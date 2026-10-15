import { lingui } from "@lingui/vite-plugin";
import babel from "@rolldown/plugin-babel";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    devtools(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    lingui(),
    babel({
      plugins: ["@lingui/babel-plugin-lingui-macro"],
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
    // 15.10, Sid ("d'autres outils pour trouver la vraie cause") - only
    // actually uploads sourcemaps when SENTRY_AUTH_TOKEN is set (CI only,
    // GitHub Actions secret), so a plain local `vite build` without that
    // token is a silent no-op rather than a failure. release = git SHA,
    // matching GIT_COMMIT_SHA already baked in below for __GIT_COMMIT_SHA__.
    sentryVitePlugin({
      org: "myown-o3",
      project: "patoune-tv",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
      release: { name: process.env.GIT_COMMIT_SHA || undefined },
      sourcemaps: { filesToDeleteAfterUpload: ["dist/**/*.map"] },
    }),
  ],
  resolve: {
    tsconfigPaths: true,
  },
  build: {
    // Needed for the Sentry plugin above to have anything to upload -
    // filesToDeleteAfterUpload strips the .map files back out of dist/
    // afterward so they're never actually served publicly.
    sourcemap: true,
  },
  server: {
    port: 3000,
    proxy: {
      "/rpc": "http://localhost:3001",
      "/api": "http://localhost:3001",
      "/images": "http://localhost:3001",
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || "0.0.0"),
    __GIT_COMMIT_SHA__: JSON.stringify((process.env.GIT_COMMIT_SHA || "").slice(0, 7)),
  },
});
