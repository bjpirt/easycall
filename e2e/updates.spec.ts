import { expect, test } from "./fixtures";

test("anyone can ask which version is deployed, and it's never cached", async ({ caller }) => {
  await caller.context().clearCookies();

  const response = await caller.request.get("/version");

  expect(response.headers()["cache-control"]).toBe("no-store");
  expect(await response.json()).toEqual({ version: expect.any(String) as unknown });
});

test("the room tells connected pages the same version", async ({ group, caller }) => {
  const welcome = new Promise<string>((resolve) => {
    caller.on("websocket", (ws) => {
      ws.on("framereceived", ({ payload }) => {
        const message = JSON.parse(String(payload)) as { type: string; version?: string };
        if (message.type === "welcome" && message.version) resolve(message.version);
      });
    });
  });
  const { version } = (await (await caller.request.get("/version")).json()) as { version: string };

  await caller.goto(`/${group}/`);

  expect(await welcome).toBe(version);
});
