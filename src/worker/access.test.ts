import { generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyAccess } from "./access";
import { audience, fakeAccessTeam, teamDomain } from "./access-test-keys";

let team: Awaited<ReturnType<typeof fakeAccessTeam>>;
const config = { teamDomain, audience };

beforeAll(async () => {
  team = await fakeAccessTeam();
});

describe("verifyAccess", () => {
  it("returns the email from a valid token", async () => {
    const token = await team.sign({ email: "ben@example.com" });

    expect(await verifyAccess(token, config, team.keys)).toBe("ben@example.com");
  });

  it("rejects a missing token", async () => {
    expect(await verifyAccess(null, config, team.keys)).toBeUndefined();
  });

  it.each([
    ["another application's audience", { aud: "other-app" }],
    ["another issuer", { iss: "https://evil.cloudflareaccess.com" }],
    ["no email (e.g. a service token)", { email: undefined, common_name: "client-id" }],
  ])("rejects a token with %s", async (_, claims) => {
    const token = await team.sign({ email: "ben@example.com", ...claims });

    expect(await verifyAccess(token, config, team.keys)).toBeUndefined();
  });

  it("rejects an expired token", async () => {
    const token = await team.sign({ email: "ben@example.com" }, { expires: "-1m" });

    expect(await verifyAccess(token, config, team.keys)).toBeUndefined();
  });

  it("rejects a token signed with someone else's key", async () => {
    const { privateKey } = await generateKeyPair("RS256");
    const token = await team.sign({ email: "ben@example.com" }, { key: privateKey });

    expect(await verifyAccess(token, config, team.keys)).toBeUndefined();
  });

  it("rejects junk", async () => {
    expect(await verifyAccess("not.a.jwt", config, team.keys)).toBeUndefined();
  });
});
