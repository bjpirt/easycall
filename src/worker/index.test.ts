import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { parseMessage, type Message } from "../shared/protocol";
import { stunOnly } from "../shared/ice";

// The test directory (vitest.config.ts) has groups "alpha" and "beta". Built
// assets aren't available here, so serving the page itself is covered by E2E.
const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(`http://example.com${path}`, { redirect: "manual", ...init });

async function connect(path: string): Promise<{ ws: WebSocket; messages: Message[] }> {
  const response = await get(path, { headers: { Upgrade: "websocket" } });
  const ws = response.webSocket;
  if (!ws) throw new Error(`No WebSocket (status ${String(response.status)})`);
  ws.accept();
  const messages: Message[] = [];
  ws.addEventListener("message", (event) => {
    const message = parseMessage(event.data);
    if (message) messages.push(message);
  });
  return { ws, messages };
}

describe("worker routing", () => {
  it("serves ICE servers, uncached (STUN only when TURN isn't configured)", async () => {
    const response = await get("/api/ice-servers");

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ iceServers: stunOnly });
  });

  it("redirects a group without its trailing slash, keeping the query", async () => {
    const response = await get("/alpha?role=caller");

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("http://example.com/alpha/?role=caller");
  });

  it.each(["/", "/nobody/", "/nobody/api/room", "/alpha/elsewhere", "/Alpha/", "/api/room"])(
    "returns 404 for %s",
    async (path) => {
      const response = await get(path);

      expect(response.status).toBe(404);
    },
  );

  it("connects to the group's room", async () => {
    const { ws, messages } = await connect("/alpha/api/room?role=caller");

    await vi.waitFor(() => {
      expect(messages).toContainEqual({ type: "status", status: "unavailable" });
    });
    ws.close();
  });

  it("keeps each group's room separate", async () => {
    const caller = await connect("/alpha/api/room?role=caller");
    await vi.waitFor(() => {
      expect(caller.messages).toEqual([{ type: "status", status: "unavailable" }]);
    });

    const otherGroup = await connect("/beta/api/room?role=receiver");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(caller.messages).toEqual([{ type: "status", status: "unavailable" }]);

    const sameGroup = await connect("/alpha/api/room?role=receiver");
    await vi.waitFor(() => {
      expect(caller.messages.at(-1)).toEqual({ type: "status", status: "available" });
    });
    for (const { ws } of [caller, otherGroup, sameGroup]) ws.close();
  });
});
