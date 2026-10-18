import { expect, signIn, test, users } from "./fixtures";

test("a signed-in member can ask who they are in the group", async ({ group, caller }) => {
  await signIn(caller, users.admin);

  const response = await caller.request.get(`/${group}/api/me`);

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    email: users.admin,
    role: "admin",
    displayName: "Grandma",
  });
});

test("who-am-I needs a session", async ({ group, caller }) => {
  expect((await caller.request.get(`/${group}/api/me`)).status()).toBe(401);
});

test("dev login is switched off in the built app", async ({ caller }) => {
  expect((await caller.request.get("/dev-login?email=admin@e2e.test")).status()).toBe(404);
});
