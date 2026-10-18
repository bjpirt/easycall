import { describe, expect, it } from "vitest";
import { readSession, sessionCookie, sessionSeconds, sessionToken } from "./session";

const secret = "test-secret";
const now = Date.UTC(2026, 9, 18);
const withCookie = (cookie: string) =>
  new Request("https://example.com/", { headers: { Cookie: cookie } });

describe("sessions", () => {
  it("round-trips the (normalised) email", async () => {
    const token = await sessionToken(" Ben@Example.com ", secret, now);

    expect(await readSession(withCookie(`session=${token}`), secret, now)).toBe("ben@example.com");
  });

  it("finds the session among other cookies", async () => {
    const token = await sessionToken("ben@example.com", secret, now);

    expect(await readSession(withCookie(`a=1; session=${token}; b=2`), secret, now)).toBe(
      "ben@example.com",
    );
  });

  it("is valid for a year", async () => {
    const token = await sessionToken("ben@example.com", secret, now);
    const request = withCookie(`session=${token}`);

    expect(await readSession(request, secret, now + (sessionSeconds - 60) * 1000)).toBeDefined();
    expect(await readSession(request, secret, now + sessionSeconds * 1000)).toBeUndefined();
  });

  it("rejects a session signed with another secret", async () => {
    const token = await sessionToken("ben@example.com", "other-secret", now);

    expect(await readSession(withCookie(`session=${token}`), secret, now)).toBeUndefined();
  });

  it("rejects a tampered payload", async () => {
    const token = await sessionToken("ben@example.com", secret, now);
    const [, signature] = token.split(".");
    const forged = btoa(JSON.stringify({ email: "admin@example.com", exp: 9999999999 }))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    expect(
      await readSession(withCookie(`session=${forged}.${String(signature)}`), secret, now),
    ).toBeUndefined();
  });

  it.each([
    ["no cookie", ""],
    ["an empty session", "session="],
    ["no signature", "session=abc"],
    ["too many parts", "session=a.b.c"],
    ["junk", "session=!!!.???"],
  ])("rejects %s", async (_, cookie) => {
    expect(await readSession(withCookie(cookie), secret, now)).toBeUndefined();
  });

  it("rejects everything when no secret is configured", async () => {
    const token = await sessionToken("ben@example.com", secret, now);

    expect(await readSession(withCookie(`session=${token}`), undefined, now)).toBeUndefined();
  });

  it("issues a secure, HTTP-only, year-long cookie", async () => {
    const cookie = await sessionCookie("ben@example.com", secret, now);

    expect(cookie).toMatch(/^session=[\w-]+\.[\w-]+; /);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${String(sessionSeconds)}`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
  });
});
