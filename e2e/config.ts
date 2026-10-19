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

/** The test server's grace period for dropped connections (short, so expiry can be tested). */
export const graceSeconds = 3;

/**
 * Each parallel worker gets a few groups and rotates through them. A room holds
 * a dropped participant's place for the grace period, so a test mustn't reuse a
 * group that a previous test left within that time (see the `group` fixture).
 */
export const groupsPerWorker = 4;
export const maxWorkers = 16;

export function e2eGroupName(worker: number, index: number): string {
  return `e2e-${String(worker)}-${String(index)}`;
}

export const e2eGroups = Array.from({ length: maxWorkers }, (_, worker) =>
  Array.from({ length: groupsPerWorker }, (_, index) => e2eGroupName(worker, index)),
).flat();

/** Every E2E group has the same members (the receiver's name is what callers see). */
export const e2eGroup = {
  members: {
    [users.receiver]: { role: "receiver", name: "Grandma" },
    [users.caller]: { role: "caller", name: "Ben" },
    [users.otherCaller]: { role: "caller", name: "Sarah" },
    [users.admin]: { role: "admin", name: "Ada" },
  },
};
