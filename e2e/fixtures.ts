import { test as base, type Browser, type Page } from "@playwright/test";
import { cookieName, sessionToken } from "../src/worker/session";
import {
  baseURL,
  e2eGroupName,
  e2eSessionSecret,
  graceSeconds,
  groupsPerWorker,
  users,
} from "./config";

/** When each of this worker's groups was last used (each worker is its own process). */
const lastUsed = new Map<string, number>();

interface Fixtures {
  /** This test's group: never shared with a concurrent test, nor reused within the grace period. */
  group: string;
  /** Pages signed in as the group's receiver, a caller and another caller. */
  receiver: Page;
  caller: Page;
  otherCaller: Page;
}

/**
 * A page in its own browser context (like a separate device), signed in as
 * `email`, with camera and mic allowed.
 */
function signedInPage(email: string) {
  return async (
    { browser }: { browser: Browser },
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
    await signIn(page, email);
    await use(page);
    await context.close();
  };
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern
  group: async ({}, use, testInfo) => {
    // This worker's least recently used group, waiting out any grace period left
    // over from the test that last used it.
    const pool = Array.from({ length: groupsPerWorker }, (_, i) =>
      e2eGroupName(testInfo.parallelIndex, i),
    );
    const [group = ""] = pool.sort((a, b) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b) ?? 0));
    const wait = (lastUsed.get(group) ?? 0) + graceSeconds * 1000 + 500 - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    await use(group);
    lastUsed.set(group, Date.now());
  },
  receiver: signedInPage(users.receiver),
  caller: signedInPage(users.caller),
  otherCaller: signedInPage(users.otherCaller),
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

export { users } from "./config";
export { expect } from "@playwright/test";
