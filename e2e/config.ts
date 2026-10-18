/** Shared by playwright.config.ts (the test server's settings) and the fixtures. */

export const port = 8788;
export const baseURL = `http://localhost:${String(port)}`;

export const e2eSessionSecret = "e2e-session-secret";

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
