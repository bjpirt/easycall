import { describe, expect, it } from "vitest";
import { safePath } from "./safe-path";

const site = new URL("https://easycall.example/login?next=x");

describe("safePath", () => {
  it.each(["/alpha/", "/alpha/?x=1#top", "/"])("keeps a path on this site: %s", (next) => {
    expect(safePath(next, site)).toBe(next);
  });

  it.each([
    ["missing", null],
    ["another site", "https://evil.example/"],
    ["a protocol-relative URL", "//evil.example/"],
    ["a backslash", "/\\evil.example/"],
    ["a tab", "/\t/evil.example/"],
    ["a newline", "/\n/evil.example/"],
    ["a relative path", "alpha/"],
    ["a javascript: URL", "javascript:alert(1)"],
  ])("goes home for %s", (_, next) => {
    expect(safePath(next, site)).toBe("/");
  });
});
