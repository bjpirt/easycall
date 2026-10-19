import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { audience, fakeAccessTeam, teamDomain } from "./access-test-keys";
import { login } from "./login";
import { readSession } from "./session";

let team: Awaited<ReturnType<typeof fakeAccessTeam>>;
const configured = { ...env, ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: audience };

beforeAll(async () => {
  team = await fakeAccessTeam();
});

const request = (path: string, token?: string) =>
  new Request(`https://easycall.example${path}`, {
    headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
  });

describe("login", () => {
  it("starts a session for the Access user and goes to next", async () => {
    const token = await team.sign({ email: "Caller@Example.com" });

    const response = await login(request("/login?next=/alpha/", token), configured, team.keys);

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/alpha/");
    const cookie = response.headers.get("Set-Cookie")?.split(";")[0] ?? "";
    const session = new Request("https://easycall.example/", { headers: { Cookie: cookie } });
    expect(await readSession(session, env.SESSION_SECRET)).toBe("caller@example.com");
  });

  it("won't redirect to another site", async () => {
    const token = await team.sign({ email: "caller@example.com" });

    const response = await login(
      request("/login?next=https://evil.example/", token),
      configured,
      team.keys,
    );

    expect(response.headers.get("Location")).toBe("/");
  });

  it("refuses without a valid Access token", async () => {
    expect((await login(request("/login"), configured, team.keys)).status).toBe(401);
    expect((await login(request("/login", "forged"), configured, team.keys)).status).toBe(401);
  });

  it("reports when sign-in isn't configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect((await login(request("/login"), env, team.keys)).status).toBe(500);
  });

  it("hands over to /dev-login when DEV_LOGIN is enabled, locally", async () => {
    const local = new Request("http://localhost:8787/login?next=/alpha/");

    const response = await login(local, { ...env, DEV_LOGIN: "true" });

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe(
      "http://localhost:8787/dev-login?next=%2Falpha%2F",
    );
  });

  it("ignores DEV_LOGIN anywhere else, still needing Access", async () => {
    const response = await login(request("/login?next=/alpha/"), {
      ...configured,
      DEV_LOGIN: "true",
    });

    expect(response.status).toBe(401);
  });

  it("won't redirect to another site via a tab in next", async () => {
    const token = await team.sign({ email: "caller@example.com" });

    const response = await login(
      request("/login?next=/%09/evil.example/", token),
      configured,
      team.keys,
    );

    expect(response.headers.get("Location")).toBe("/");
  });
});
