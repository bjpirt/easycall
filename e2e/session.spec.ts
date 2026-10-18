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
  await caller.context().clearCookies();

  expect((await caller.request.get(`/${group}/api/me`)).status()).toBe(401);
});

test("dev login is switched off in the built app", async ({ caller }) => {
  expect((await caller.request.get("/dev-login?email=admin@e2e.test")).status()).toBe(404);
});

test("each person sees the view for their role", async ({ group, receiver, caller }) => {
  await receiver.goto(`/${group}/`);
  await caller.goto(`/${group}/`);

  await expect(receiver.getByRole("button", { name: "Join call" })).toBeVisible();
  await expect(receiver.getByText("Grandma")).toHaveCount(0); // the receiver view has no status line
  await expect(caller.getByText("Grandma isn't available right now")).toBeVisible();
});

test("someone not signed in is sent to log in, and back afterwards", async ({ group, caller }) => {
  await caller.context().clearCookies();

  const response = await caller.request.get(`/${group}/`, { maxRedirects: 0 });

  expect(response.status()).toBe(302);
  expect(response.headers().location).toMatch(
    new RegExp(`/login\\?next=${encodeURIComponent(`/${group}/`)}$`),
  );
});

test("someone who isn't a member gets a 404", async ({ group, caller }) => {
  await signIn(caller, "stranger@e2e.test");

  const response = await caller.goto(`/${group}/`);

  expect(response?.status()).toBe(404);
});

test("the APIs need a member's session", async ({ group, caller }) => {
  for (const path of ["api/me", "api/ice-servers"]) {
    expect((await caller.request.get(`/${group}/${path}`)).status()).toBe(200);
  }
  await caller.context().clearCookies();
  for (const path of ["api/me", "api/ice-servers", "api/room"]) {
    expect((await caller.request.get(`/${group}/${path}`)).status()).toBe(401);
  }
});
