import { test as base, type Browser, type Page } from "@playwright/test";
import { cookieName, sessionToken } from "../src/worker/session";
import { baseURL, e2eSessionSecret, users } from "./config";

interface Fixtures {
  /** This test's group: one per parallel worker, so concurrent tests never share a room. */
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
    const page = await context.newPage();
    await signIn(page, email);
    await use(page);
    await context.close();
  };
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern
  group: async ({}, use, testInfo) => {
    await use(`e2e-${String(testInfo.parallelIndex)}`);
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

export { users } from "./config";
export { expect } from "@playwright/test";
