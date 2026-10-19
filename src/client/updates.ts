import { appVersion } from "../shared/version";
import type { Page } from "./wake-lock";

/** How often an open page checks for a new version (pages in a call also hear it from the room). */
export const checkEveryMs = 10 * 60_000;

/** How long a page waits on its idle screen before reloading, so messages stay readable. */
export const reloadAfterIdleMs = 60_000;

export interface Updates {
  /** A version heard from the server (e.g. the room's `welcome`). */
  noteVersion: (version: string) => void;
  /** The page is in use (joining, waiting or in a call): never reload now. */
  busy: () => void;
  /** Back on the idle screen: reload soon if there's a newer version. */
  idle: () => void;
}

export interface UpdateDeps {
  fetchVersion: () => Promise<string | undefined>;
  reload: () => void;
  page: Page;
}

/**
 * Keeps long-open pages (like the tablet, left on for days) up to date. Opening
 * or reloading always gets the latest version (there's no service worker
 * caching it), so when a newer version is deployed, the page reloads itself,
 * but only once it's back on its idle screen, never during a call.
 */
export function watchForUpdates(deps: UpdateDeps = browser(), current = appVersion): Updates {
  let outdated = false;
  let inUse = false;
  let reload: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    clearTimeout(reload);
    if (outdated && !inUse) reload = setTimeout(deps.reload, reloadAfterIdleMs);
  };
  const noteVersion = (version: string): void => {
    if (version === current || outdated) return;
    outdated = true;
    schedule();
  };
  const check = async (): Promise<void> => {
    const version = await deps.fetchVersion();
    if (version) noteVersion(version);
  };

  setInterval(() => void check(), checkEveryMs);
  deps.page.addEventListener("visibilitychange", () => {
    if (deps.page.visibilityState === "visible") void check();
  });

  return {
    noteVersion,
    busy: () => {
      inUse = true;
      clearTimeout(reload);
    },
    idle: () => {
      inUse = false;
      schedule();
    },
  };
}

function browser(): UpdateDeps {
  return {
    fetchVersion: async () => {
      try {
        const response = await fetch("/version", { cache: "no-store" });
        const { version } = (await response.json()) as { version?: unknown };
        return typeof version === "string" ? version : undefined;
      } catch {
        return undefined; // offline: try again later
      }
    },
    reload: () => {
      location.reload();
    },
    page: document,
  };
}
