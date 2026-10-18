import { expect, test } from "./fixtures";

// The E2E server runs with a 6-second ready window (see playwright.config.ts).
test("if nobody calls, the receiver goes back to idle and becomes unavailable", async ({
  receiver,
  caller,
}) => {
  await caller.goto("/?role=caller");
  await receiver.goto("/?role=receiver");
  await receiver.getByRole("button", { name: "Join call" }).click();
  await expect(caller.getByText("Ready for a call")).toBeVisible();

  await expect(receiver.getByText("No calls just now.")).toBeVisible({ timeout: 15_000 });
  await expect(receiver.getByRole("button", { name: "Join call" })).toBeVisible();
  await expect(receiver.locator("video")).toHaveCount(0);
  await expect(caller.getByText("Not available right now")).toBeVisible();
});
