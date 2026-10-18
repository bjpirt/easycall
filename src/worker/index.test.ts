import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// Static files are served by Cloudflare before the Worker runs, so they aren't
// visible here; the E2E tests cover them.
describe("worker", () => {
  it("routes /api/room to the room", async () => {
    const response = await exports.default.fetch("http://example.com/api/room?role=caller", {
      headers: { Upgrade: "websocket" },
    });

    expect(response.status).toBe(101);
    response.webSocket?.accept();
    response.webSocket?.close();
  });

  it("returns 404 for paths that aren't static assets", async () => {
    const response = await exports.default.fetch("http://example.com/nope");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });
});
