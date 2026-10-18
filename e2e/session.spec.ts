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

test("someone not signed in is asked to sign in", async ({ group, caller }) => {
  await caller.context().clearCookies();

  await caller.goto(`/${group}/`);

  await expect(caller.getByText("Please sign in to continue.")).toBeVisible();
  await expect(caller.getByRole("link", { name: "Sign in" })).toHaveAttribute(
    "href",
    `/login?next=${encodeURIComponent(`/${group}/`)}`,
  );
});

test("someone who isn't a member is told so", async ({ group, caller }) => {
  await signIn(caller, "stranger@e2e.test");

  await caller.goto(`/${group}/`);

  await expect(
    caller.getByText("You're not a member of this group.", { exact: false }),
  ).toBeVisible();
});
