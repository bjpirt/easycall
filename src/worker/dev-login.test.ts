import { describe, expect, it } from "vitest";
import { devLogin } from "./dev-login";

const login = (query: string, secret: string | undefined) =>
  devLogin(new Request(`http://localhost/dev-login${query}`), secret);

describe("devLogin", () => {
  it("shows a form when no email is given, keeping next (escaped)", async () => {
    const response = await login("?next=" + encodeURIComponent("/alpha/?a=1&b=2"), "test-secret");
    const html = await response.text();

    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(html).toContain('<input name="email"');
    expect(html).toContain('value="/alpha/?a=1&#38;b=2"');
  });

  it("sets the session cookie and redirects to next", async () => {
    const response = await login("?email=ben@example.com&next=/alpha/", "test-secret");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("/alpha/");
    expect(response.headers.get("Set-Cookie")).toMatch(/^session=/);
  });

  it("needs SESSION_SECRET", async () => {
    expect((await login("?email=ben@example.com", undefined)).status).toBe(500);
  });
});
