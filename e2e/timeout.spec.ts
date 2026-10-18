import { expect, test } from "./fixtures";

// The E2E server runs with a 6-second ready window (see playwright.config.ts).
test("if nobody calls, the receiver goes back to idle and becomes unavailable", async ({
  group,
  receiver,
  caller,
}) => {
  await caller.goto(`/${group}/`);
  await receiver.goto(`/${group}/`);
  await receiver.getByRole("button", { name: "Join call" }).click();
  await expect(caller.getByText("Grandma is ready for a call")).toBeVisible();

  await expect(receiver.getByText("No calls just now.")).toBeVisible({ timeout: 15_000 });
  await expect(receiver.getByRole("button", { name: "Join call" })).toBeVisible();
  await expect(receiver.locator("video")).toHaveCount(0);
  await expect(caller.getByText("Grandma isn't available right now")).toBeVisible();
});
