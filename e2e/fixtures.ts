import { test as base, type Browser, type Page } from "@playwright/test";
import { cookieName, sessionToken } from "../src/worker/session";
import { baseURL, e2eSessionSecret } from "./config";

interface Fixtures {
  /** This test's group: one per parallel worker, so concurrent tests never share a room. */
  group: string;
  receiver: Page;
  caller: Page;
  otherCaller: Page;
}

/** A page in its own browser context (like a separate device) with camera and mic allowed. */
async function peer(
  { browser, baseURL }: { browser: Browser; baseURL: string | undefined },
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    ...(baseURL && { baseURL }),
    permissions: ["camera", "microphone"],
  });
  await use(await context.newPage());
  await context.close();
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern
  group: async ({}, use, testInfo) => {
    await use(`e2e-${String(testInfo.parallelIndex)}`);
  },
  receiver: peer,
  caller: peer,
  otherCaller: peer,
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
