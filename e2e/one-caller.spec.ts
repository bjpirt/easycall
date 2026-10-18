import { expect, test } from "./fixtures";

test("only one of two callers joining at once gets the call", async ({
  group,
  receiver,
  caller,
  otherCaller,
}) => {
  await receiver.goto(`/${group}/?role=receiver`);
  await receiver.getByRole("button", { name: "Join call" }).click();
  for (const page of [caller, otherCaller]) {
    await page.goto(`/${group}/?role=caller`);
    await expect(page.getByRole("button", { name: "Join call" })).toBeEnabled();
  }

  // Press both buttons at (nearly) the same moment.
  await Promise.all(
    [caller, otherCaller].map((page) =>
      page.getByRole("button", { name: "Join call" }).evaluate((b: HTMLButtonElement) => {
        b.click();
      }),
    ),
  );

  // Exactly one is connected; the other is back on the idle screen, told it's busy.
  await expect(receiver.locator("video.remote-view")).toBeVisible();
  await expect
    .poll(async () => {
      const connected = await Promise.all(
        [caller, otherCaller].map((page) => page.locator("video.remote-view").count()),
      );
      return connected.sort();
    })
    .toEqual([0, 1]);
  const [loser] = (await caller.locator("video.remote-view").count()) ? [otherCaller] : [caller];
  await expect(loser.getByText("In a call", { exact: true })).toBeVisible();
  await expect(loser.getByRole("button", { name: "Join call" })).toBeDisabled();
});
