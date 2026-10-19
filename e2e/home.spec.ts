import { expect, signIn, test } from "./fixtures";

test("the home page explains easyCall and offers to sign in", async ({ caller }) => {
  await caller.context().clearCookies();

  await caller.goto("/");

  await expect(caller.getByRole("heading", { name: "easyCall" })).toBeVisible();
  await expect(caller.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
});

test("once signed in, the home page goes to your group", async ({ group, caller }) => {
  await caller.goto("/");

  await expect(caller).toHaveURL(`/${group}/`);
  await expect(caller.getByText("Signed in as Ben")).toBeVisible();
});

test("someone signed in who isn't in a group is told so", async ({ caller }) => {
  await signIn(caller, "stranger@e2e.test");

  await caller.goto("/");

  await expect(caller.getByText("You're signed in as stranger@e2e.test")).toBeVisible();
  await expect(caller.getByRole("link", { name: "Sign in" })).toHaveCount(0);
});
