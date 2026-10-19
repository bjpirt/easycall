import { env, exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { stunOnly } from "../shared/ice";
import { parseMessage, type Message } from "../shared/protocol";
import worker from "./index";
import { sessionToken } from "./session";

// The test directory (vitest.config.ts) has groups "alpha" (receiver@ "Alpha",
// caller@ "Cal" and admin@example.com "Ada") and "beta" (beta-receiver@ "Beta" and
// beta-caller@ "Bea"), and SESSION_SECRET "test-secret".
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
  it("tells anyone the deployed version, uncached", async () => {
    const response = await get("/version");

    expect(await response.json()).toEqual({ version: "test-version" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("redirects a group without its trailing slash, keeping the query", async () => {
    const response = await get("/alpha?x=1");

    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("http://example.com/alpha/?x=1");
  });

  it.each(["/nobody/", "/nobody/api/room", "/Alpha/", "/api/room", "/api/ice-servers"])(
    "returns 404 for %s",
    async (path) => {
      expect((await get(path, await as("admin@example.com"))).status).toBe(404);
    },
  );

  it("returns 404 for unknown paths in a group, even for members", async () => {
    expect((await get("/alpha/elsewhere", await as("admin@example.com"))).status).toBe(404);
  });
});

describe("the home page", () => {
  it("explains easyCall to someone who isn't signed in, with a Sign in button", async () => {
    const response = await get("/");
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(html).toContain("video call");
    expect(html).toContain('<a class="button" href="/login">Sign in</a>');
  });

  it.each([
    ["receiver@example.com", "/alpha/"],
    ["Admin@Example.com", "/alpha/"],
    ["beta-caller@example.com", "/beta/"],
  ])("sends %s, once signed in, to their group", async (email, path) => {
    const response = await get("/", await as(email));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(`http://example.com${path}`);
  });

  it("tells someone signed in who isn't in a group, without a Sign in button", async () => {
    const html = await (await get("/", await as("stranger@example.com"))).text();

    expect(html).toContain("You're signed in as stranger@example.com");
    expect(html).not.toContain('href="/login"');
  });

  it("ignores a forged session", async () => {
    const response = await get("/", { headers: { Cookie: "session=forged.token" } });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain('href="/login"');
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

  it("doesn't let anyone signed out find out which groups exist", async () => {
    for (const [real, madeUp] of [
      ["/alpha", "/nobody"],
      ["/alpha/", "/nobody/"],
      ["/alpha/api/me", "/nobody/api/me"],
      ["/alpha/api/room", "/nobody/api/room"],
    ]) {
      const [a, b] = await Promise.all([get(real ?? ""), get(madeUp ?? "")]);
      expect([a.status, b.status]).toEqual([b.status, a.status]);
      expect(a.status).not.toBe(404);
    }
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
  it("refuses connections from other sites", async () => {
    const init = withHeader(await as("caller@example.com"), "Upgrade", "websocket");

    const response = await get(
      "/alpha/api/room",
      withHeader(init, "Origin", "https://evil.example"),
    );

    expect(response.status).toBe(403);
    expect(response.webSocket).toBeNull();
  });

  it("accepts connections from our own pages", async () => {
    const caller = await connect(
      "/alpha/api/room",
      withHeader(await as("caller@example.com"), "Origin", "http://example.com"),
    );

    await vi.waitFor(() => {
      expect(caller.messages).toContainEqual({ type: "status", status: "unavailable" });
    });
    caller.ws.close();
  });

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
    const caller = await connect("/beta/api/room", await as("beta-caller@example.com"));
    await vi.waitFor(() => {
      expect(caller.messages).toEqual([
        { type: "welcome", resumed: false, version: "test-version" },
        { type: "status", status: "unavailable" },
      ]);
    });

    const otherGroup = await connect("/alpha/api/room", await as("receiver@example.com"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(caller.messages).toEqual([
      { type: "welcome", resumed: false, version: "test-version" },
      { type: "status", status: "unavailable" },
    ]);
    for (const { ws } of [caller, otherGroup]) ws.close();
  });
});

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

describe("/dev-login", () => {
  it("doesn't exist unless DEV_LOGIN is enabled", async () => {
    expect((await get("/dev-login?email=admin@example.com")).status).toBe(404);
  });

  const devLoginAt = (host: string) =>
    worker.fetch(
      new IncomingRequest(`http://${host}/dev-login?email=caller@example.com&next=/alpha/`),
      { ...env, DEV_LOGIN: "true" },
    );

  it("doesn't exist anywhere but on a local address, even with DEV_LOGIN enabled", async () => {
    expect((await devLoginAt("example.com")).status).toBe(404);
    expect((await devLoginAt("localhost.example.com")).status).toBe(404);
  });

  it.each(["localhost", "localhost:8787", "127.0.0.1"])(
    "signs in on %s when DEV_LOGIN is enabled",
    async (host) => {
      expect((await devLoginAt(host)).status).toBe(302);
    },
  );

  it("signs in when DEV_LOGIN is enabled", async () => {
    const response = await devLoginAt("localhost");

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
