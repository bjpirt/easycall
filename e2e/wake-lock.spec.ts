import { expect, test } from "./fixtures";

test("the tablet keeps its screen awake from Join call until it's back to idle", async ({
  group,
  receiver,
  caller,
}) => {
  // Headless browsers can't really hold a wake lock, so record what the app asks for.
  await receiver.addInitScript(() => {
    const log: string[] = [];
    Object.assign(window, { __wakeLog: log });
    Object.defineProperty(navigator, "wakeLock", {
      value: {
        request: (type: string) => {
          log.push(`request ${type}`);
          return Promise.resolve({
            released: false,
            release: () => {
              log.push("release");
              return Promise.resolve();
            },
          });
        },
      },
    });
  });
  const wakeLog = () =>
    receiver.evaluate(() => (window as unknown as { __wakeLog: string[] }).__wakeLog);

  await receiver.goto(`/${group}/`);
  expect(await wakeLog()).toEqual([]); // idle: the screen may sleep

  await receiver.getByRole("button", { name: "Join call" }).click();
  await expect.poll(wakeLog).toEqual(["request screen"]);

  // A call comes in and ends: back to idle, so the lock is released.
  await caller.goto(`/${group}/`);
  await caller.getByRole("button", { name: "Join call" }).click();
  await expect(receiver.locator("video.remote-view")).toBeVisible();
  await caller.getByRole("button", { name: "Hang up" }).click();
  await expect(receiver.getByText("The call has ended.")).toBeVisible();

  await expect.poll(wakeLog).toEqual(["request screen", "release"]);
});
