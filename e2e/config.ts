/** Shared by playwright.config.ts (the test server's settings) and the fixtures. */

export const port = 8788;
export const baseURL = `http://localhost:${String(port)}`;

/**
 * Random per test run (set once by playwright.config.ts and inherited by the
 * workers). The E2E build bakes it into dist/, so it must never be a known
 * value: an accidental `wrangler deploy` of that build mustn't let anyone forge
 * a session. Always deploy with `npm run deploy`, which rebuilds.
 */
export const e2eSessionSecret = process.env.E2E_SESSION_SECRET ?? "";

export const users = {
  receiver: "receiver@e2e.test",
  caller: "caller@e2e.test",
  otherCaller: "other-caller@e2e.test",
  admin: "admin@e2e.test",
} as const;

/** Every E2E group (one per parallel worker) has the same members. */
export const e2eGroup = {
  displayName: "Grandma",
  members: {
    [users.receiver]: "receiver",
    [users.caller]: "caller",
    [users.otherCaller]: "caller",
    [users.admin]: "admin",
  },
};
