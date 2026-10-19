import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// E2E tests supply their own groups, session secret and short timers via env vars.
const e2eVars = Object.fromEntries(
  ["READY_WINDOW_MINUTES", "GRACE_SECONDS", "DIRECTORY", "SESSION_SECRET"].flatMap((name) => {
    const value = process.env[name];
    return value ? [[name, value]] : [];
  }),
);

/**
 * `.dev.vars`, for `npm run dev` only. Wrangler only loads the secrets listed in
 * `secrets.required`, and that's empty (see wrangler.jsonc), so it would load
 * none. Never used for a build, so local settings can't end up in a deploy.
 */
function devVars(): Record<string, string> {
  if (!existsSync(".dev.vars")) return {};
  const parsed = parseEnv(readFileSync(".dev.vars", "utf8"));
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])),
  );
}

/** This build's version: the git commit (marked "-dirty" if there are uncommitted changes). */
function version(): string {
  try {
    return execSync("git describe --always --dirty --abbrev=12").toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(({ command, isPreview }) => {
  const devServer = command === "serve" && !isPreview;
  const vars = { ...(devServer ? devVars() : {}), ...e2eVars };
  return {
    plugins: [
      cloudflare({
        ...(Object.keys(vars).length ? { config: { vars } } : {}),
        // E2E rooms start empty each run: saved state could hold a previous run's call.
        persistState: !process.env.E2E,
      }),
    ],
    define: {
      // Baked into both the Worker and the page, so open pages can tell they're out of date.
      __APP_VERSION__: JSON.stringify(version()),
      // Only under `npm run dev`, whose CSS arrives as inline styles (see security-headers.ts).
      __DEV_SERVER__: JSON.stringify(devServer),
    },
    server: { port: 8787 },
  };
});
