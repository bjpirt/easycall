import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseDirectory } from "./directory";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("parseDirectory", () => {
  it("finds groups by slug", () => {
    const directory = parseDirectory(
      JSON.stringify({
        groups: { smith: { displayName: "Grandma" }, "jones-2": { displayName: "Dad" } },
      }),
    );

    expect(directory.group("smith")).toEqual({ slug: "smith", displayName: "Grandma" });
    expect(directory.group("jones-2")).toEqual({ slug: "jones-2", displayName: "Dad" });
    expect(directory.group("nobody")).toBeUndefined();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["not JSON", "{groups"],
    ["without groups", "{}"],
    ["with groups as an array", JSON.stringify({ groups: [] })],
  ])("is empty when %s", (_, json) => {
    expect(parseDirectory(json).group("smith")).toBeUndefined();
  });

  it.each([
    ["an invalid slug", "Smith Family", { displayName: "Grandma" }],
    ["a slug ending in a hyphen", "smith-", { displayName: "Grandma" }],
    ["no display name", "smith", {}],
    ["a blank display name", "smith", { displayName: "  " }],
  ])("skips a group with %s", (_, slug, group) => {
    const directory = parseDirectory(
      JSON.stringify({ groups: { [slug]: group, ok: { displayName: "Mum" } } }),
    );

    expect(directory.group(slug)).toBeUndefined();
    expect(directory.group("ok")).toBeDefined();
  });
});
