import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { stunOnly } from "../shared/ice";
import { parseMessage, type Message } from "../shared/protocol";
import worker from "./index";
import { sessionToken } from "./session";

// The test directory (vitest.config.ts) has groups "alpha" (receiver@ "Alpha",
// caller@ "Cal" and admin@example.com "Ada") and "beta" (beta-receiver@ "Beta" and
// caller@ "Cal"), and SESSION_SECRET "test-secret".
// Built assets aren't available here, so serving the page is covered by E2E.

function withHeader(init: RequestInit, name: string, value: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set(name, value);
  return { ...init, headers };
}

async function as(email: string): Promise<RequestInit> {
  return withHeader({}, "Cookie", `session=${await sessionToken(email, "test-secret")}`);
}

const get = (path: string, init?: RequestInit) =>
  exports.default.fetch(`http://example.com${path}`, { redirect: "manual", ...init });

async function connect(
  path: string,
  init: RequestInit,
): Promise<{ ws: WebSocket; messages: Message[] }> {
  const response = await get(path, withHeader(init, "Upgrade", "websocket"));
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

describe("routing", () => {
  it("redirects a group without its trailing slash, keeping the query", async () => {
    const response = await get("/alpha?x=1");

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("http://example.com/alpha/?x=1");
  });

  it.each(["/", "/nobody/", "/nobody/api/room", "/Alpha/", "/api/room", "/api/ice-servers"])(
    "returns 404 for %s",
    async (path) => {
      expect((await get(path, await as("admin@example.com"))).status).toBe(404);
    },
  );

  it("returns 404 for unknown paths in a group, even for members", async () => {
    expect((await get("/alpha/elsewhere", await as("admin@example.com"))).status).toBe(404);
  });
});

describe("the page", () => {
  it("sends someone who isn't signed in to log in, then back", async () => {
    const response = await get("/alpha/?x=1");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "http://example.com/login?next=%2Falpha%2F%3Fx%3D1",
    );
  });

  it("is 404 for someone who isn't a member", async () => {
    expect((await get("/beta/", await as("admin@example.com"))).status).toBe(404);
  });
});

describe("the APIs", () => {
  it.each([
    "/alpha/api/me",
    "/alpha/api/ice-servers",
    "/alpha/api/room",
    "/alpha/manifest.webmanifest",
  ])("%s is 401 without a valid session", async (path) => {
    expect((await get(path)).status).toBe(401);
    expect((await get(path, { headers: { Cookie: "session=forged.token" } })).status).toBe(401);
  });

  it.each([
    "/alpha/api/me",
    "/alpha/api/ice-servers",
    "/alpha/api/room",
    "/alpha/manifest.webmanifest",
  ])("%s is 404 for someone who isn't a member", async (path) => {
    expect((await get(path.replace("alpha", "beta"), await as("admin@example.com"))).status).toBe(
      404,
    );
    expect((await get(path, await as("stranger@example.com"))).status).toBe(404);
  });
});

describe("/<group>/api/me", () => {
  it.each([
    ["receiver@example.com", "receiver", "Alpha"],
    ["caller@example.com", "caller", "Cal"],
    ["Admin@Example.com", "admin", "Ada"],
  ])("tells %s their role, their name and the receiver's name", async (email, role, name) => {
    const response = await get("/alpha/api/me", await as(email));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: email.toLowerCase(),
      name,
      role,
      receiverName: "Alpha",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("renews the session", async () => {
    const response = await get("/alpha/api/me", await as("caller@example.com"));

    expect(response.headers.get("Set-Cookie")).toMatch(/^session=.+Max-Age=31536000/);
  });
});

describe("/<group>/api/ice-servers", () => {
  it("gives members ICE servers, uncached (STUN only when TURN isn't configured)", async () => {
    const response = await get("/alpha/api/ice-servers", await as("caller@example.com"));

    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ iceServers: stunOnly });
  });
});

describe("/<group>/api/room", () => {
  it("takes the role from the directory, not the URL", async () => {
    // A caller claiming to be the receiver still joins as a caller (callers get a status).
    const caller = await connect("/alpha/api/room?role=receiver", await as("caller@example.com"));

    await vi.waitFor(() => {
      expect(caller.messages).toContainEqual({ type: "status", status: "unavailable" });
    });
    caller.ws.close();
  });

  it("joins admins as callers", async () => {
    const admin = await connect("/alpha/api/room", await as("admin@example.com"));

    await vi.waitFor(() => {
      expect(admin.messages).toContainEqual({ type: "status", status: "unavailable" });
    });
    admin.ws.close();
  });

  it("keeps each group's room separate", async () => {
    const caller = await connect("/beta/api/room", await as("caller@example.com"));
    await vi.waitFor(() => {
      expect(caller.messages).toEqual([
        { type: "welcome", resumed: false },
        { type: "status", status: "unavailable" },
      ]);
    });

    const otherGroup = await connect("/alpha/api/room", await as("receiver@example.com"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(caller.messages).toEqual([
      { type: "welcome", resumed: false },
      { type: "status", status: "unavailable" },
    ]);
    for (const { ws } of [caller, otherGroup]) ws.close();
  });
});

describe("/dev-login", () => {
  it("doesn't exist unless DEV_LOGIN is enabled", async () => {
    expect((await get("/dev-login?email=admin@example.com")).status).toBe(404);
  });

  it("signs in when DEV_LOGIN is enabled", async () => {
    const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;
    const request = new IncomingRequest(
      "http://example.com/dev-login?email=caller@example.com&next=/alpha/",
    );

    const response = await worker.fetch(request, { ...env, DEV_LOGIN: "true" });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/alpha/");
    const cookie = response.headers.get("Set-Cookie")?.split(";")[0] ?? "";
    expect(
      await (await get("/alpha/api/me", { headers: { Cookie: cookie } })).json(),
    ).toMatchObject({
      role: "caller",
    });
  });
});

describe("/<group>/manifest.webmanifest", () => {
  it.each([
    ["receiver@example.com", "fullscreen"],
    ["caller@example.com", "standalone"],
  ])("is the installable app for %s's role (%s)", async (email, display) => {
    const response = await get("/alpha/manifest.webmanifest", await as(email));

    expect(response.headers.get("Content-Type")).toBe("application/manifest+json");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ display, start_url: "/alpha/" });
  });
});
