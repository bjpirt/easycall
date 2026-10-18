import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// Static files in public/ are served by Cloudflare before the Worker runs, so
// they aren't visible here; the E2E tests (step 3) cover them.
describe("worker", () => {
  it("returns 404 for paths that aren't static assets", async () => {
    const response = await exports.default.fetch("http://example.com/nope");

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Not found");
  });
});
