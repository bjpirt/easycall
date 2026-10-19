import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test as base, type Browser, type Page } from "@playwright/test";
import { cookieName, sessionToken } from "../src/worker/session";
import {
  baseURL,
  e2eGroupName,
  e2eRunId,
  e2eSessionSecret,
  graceSeconds,
  e2eUsers,
  groupsPerWorker,
} from "./config";

/**
 * When each of a parallel slot's groups was last used (group → time), in a file
 * for this run. Not in memory: Playwright replaces a worker after a failure (and
 * for each --repeat-each), and its replacement, in the same slot, must still
 * know which groups are busy holding a call for its grace period.
 */
function lastUsedFile(slot: number): string {
  return join(tmpdir(), `easycall-e2e-${e2eRunId}-${String(slot)}.json`);
}

function readLastUsed(slot: number): Record<string, number> {
  try {
    return JSON.parse(readFileSync(lastUsedFile(slot), "utf8")) as Record<string, number>;
  } catch {
    return {}; // none used yet
  }
}

interface Fixtures {
  /** This test's group: never shared with a concurrent test, nor reused within the grace period. */
  group: string;
  /** The group's members' emails. */
  users: ReturnType<typeof e2eUsers>;
  /** Pages signed in as the group's receiver, a caller and another caller. */
  receiver: Page;
  caller: Page;
  otherCaller: Page;
}

/**
 * A page in its own browser context (like a separate device), signed in as the
 * group's `who`, with camera and mic allowed.
 */
function signedInPage(who: keyof ReturnType<typeof e2eUsers>) {
  return async (
    { browser, users }: { browser: Browser; users: ReturnType<typeof e2eUsers> },
    use: (page: Page) => Promise<void>,
  ): Promise<void> => {
    const context = await browser.newContext({ baseURL, permissions: ["camera", "microphone"] });
    // Record the page's WebSockets, so tests can drop a connection (see dropConnection).
    await context.addInitScript(() => {
      const sockets: WebSocket[] = [];
      Object.assign(window, { __sockets: sockets });
      window.WebSocket = class extends WebSocket {
        constructor(...args: ConstructorParameters<typeof WebSocket>) {
          super(...args);
          sockets.push(this);
        }
      };
    });
    const page = await context.newPage();
    await signIn(page, users[who]);
    await use(page);
    await context.close();
  };
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern
  group: async ({}, use, testInfo) => {
    // This slot's least recently used group, waiting out any grace period left
    // over from the test that last used it. (Only one worker uses a slot at a time.)
    const slot = testInfo.parallelIndex;
    const markUsed = (group: string): void => {
      writeFileSync(
        lastUsedFile(slot),
        JSON.stringify({ ...readLastUsed(slot), [group]: Date.now() }),
      );
    };
    const lastUsed = readLastUsed(slot);
    const pool = Array.from({ length: groupsPerWorker }, (_, i) => e2eGroupName(slot, i));
    const [group = ""] = pool.sort((a, b) => (lastUsed[a] ?? 0) - (lastUsed[b] ?? 0));
    const wait = (lastUsed[group] ?? 0) + graceSeconds * 1000 + 500 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    markUsed(group); // in case this worker is replaced mid-test
    await use(group);
    markUsed(group);
  },
  users: async ({ group }, use) => {
    await use(e2eUsers(group));
  },
  receiver: signedInPage("receiver"),
  caller: signedInPage("caller"),
  otherCaller: signedInPage("otherCaller"),
});

/** Signs a page's browser context in as `email`, as if they'd been through the login. */
export async function signIn(page: Page, email: string): Promise<void> {
  const value = await sessionToken(email, e2eSessionSecret);
  await page
    .context()
    .addCookies([
      { name: cookieName, value, url: baseURL, httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
}

/** Drops the page's room connection, as a network blip would (no hang-up is sent). */
export async function dropConnection(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { __sockets: sockets } = window as unknown as { __sockets: WebSocket[] };
    sockets.at(-1)?.close();
  });
}

export { expect } from "@playwright/test";
