import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, withSecurityHeaders } from "./security-headers";

describe("contentSecurityPolicy", () => {
  it("only allows our own resources, and no framing", () => {
    const policy = contentSecurityPolicy();

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self'");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("unsafe");
  });

  it("can let one inline style through, by nonce", () => {
    expect(contentSecurityPolicy("abc")).toContain("style-src 'self' 'nonce-abc'");
  });
});

describe("withSecurityHeaders", () => {
  it("adds the headers, keeping the response's own", async () => {
    const response = withSecurityHeaders(
      new Response("hi", { status: 201, headers: { "Content-Security-Policy": "mine" } }),
    );

    expect(response.status).toBe(201);
    expect(await response.text()).toBe("hi");
    expect(response.headers.get("Content-Security-Policy")).toBe("mine");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=(self)");
  });

  it("works on redirects, whose headers can't be changed in place", () => {
    const response = withSecurityHeaders(Response.redirect("https://example.com/", 302));

    expect(response.headers.get("Location")).toBe("https://example.com/");
    expect(response.headers.get("Content-Security-Policy")).toBe(contentSecurityPolicy());
  });
});
