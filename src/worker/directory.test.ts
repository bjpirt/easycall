import { beforeEach, describe, expect, it, vi } from "vitest";
import { directoryProblems, parseDirectory } from "./directory";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const directoryOf = (groups: unknown) => parseDirectory(JSON.stringify({ groups }));

describe("parseDirectory", () => {
  it("finds groups by slug", () => {
    const directory = directoryOf({
      smith: { displayName: "Grandma" },
      "jones-2": { displayName: "Dad" },
    });

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
    [
      "more than one receiver",
      "smith",
      { displayName: "Grandma", members: { "a@x.com": "receiver", "b@x.com": "receiver" } },
    ],
  ])("skips a group with %s", (_, slug, group) => {
    const directory = directoryOf({ [slug]: group, ok: { displayName: "Mum" } });

    expect(directory.group(slug)).toBeUndefined();
    expect(directory.group("ok")).toBeDefined();
  });

  describe("members", () => {
    const directory = directoryOf({
      smith: {
        displayName: "Grandma",
        members: {
          "Tablet@Example.com": "receiver",
          "ben@example.com": "admin",
          "sis@example.com": "caller",
          "not-an-email": "caller",
          "bad@example.com": "superuser",
        },
      },
      jones: { displayName: "Dad", members: { "ben@example.com": "caller" } },
    });

    it("looks up each member's role in a group", () => {
      expect(directory.role("smith", "tablet@example.com")).toBe("receiver");
      expect(directory.role("smith", "ben@example.com")).toBe("admin");
      expect(directory.role("smith", "sis@example.com")).toBe("caller");
    });

    it("matches emails case-insensitively, ignoring surrounding spaces", () => {
      expect(directory.role("smith", " TABLET@example.COM ")).toBe("receiver");
    });

    it("lets a user have a different role in each group", () => {
      expect(directory.role("jones", "ben@example.com")).toBe("caller");
    });

    it.each([
      ["a non-member", "smith", "stranger@example.com"],
      ["a member of another group", "jones", "sis@example.com"],
      ["an invalid email", "smith", "not-an-email"],
      ["an invalid role", "smith", "bad@example.com"],
      ["an unknown group", "nobody", "ben@example.com"],
    ])("has no role for %s", (_, slug, email) => {
      expect(directory.role(slug, email)).toBeUndefined();
    });

    it("allows a group with no members yet", () => {
      expect(directoryOf({ smith: { displayName: "Grandma" } }).group("smith")).toBeDefined();
    });
  });
});

describe("emails", () => {
  it("lists every member once, normalised and sorted", () => {
    const directory = directoryOf({
      smith: { displayName: "Grandma", members: { "Zed@x.com": "caller", "amy@x.com": "admin" } },
      jones: { displayName: "Dad", members: { "amy@x.com": "caller" } },
    });

    expect(directory.emails()).toEqual(["amy@x.com", "zed@x.com"]);
  });
});

describe("directoryProblems", () => {
  it("is empty for a valid directory", () => {
    const json = JSON.stringify({
      groups: { smith: { displayName: "Grandma", members: { "a@x.com": "receiver" } } },
    });

    expect(directoryProblems(json)).toEqual([]);
  });

  it("describes every problem", () => {
    const json = JSON.stringify({
      groups: {
        "Bad Name": { displayName: "X" },
        nameless: {},
        smith: {
          displayName: "Grandma",
          members: {
            "not-an-email": "caller",
            "a@x.com": "boss",
            "r1@x.com": "receiver",
            "r2@x.com": "receiver",
          },
        },
      },
    });

    expect(directoryProblems(json)).toEqual([
      'group "Bad Name" isn\'t a valid URL name (lowercase letters, digits and hyphens)',
      'group "nameless" needs a displayName',
      'group "smith": "not-an-email" isn\'t an email address',
      'group "smith": a@x.com has an unknown role',
      'group "smith" has more than one receiver',
    ]);
  });

  it("reports JSON that isn't a directory", () => {
    expect(directoryProblems("[1, 2]")).toEqual([
      'it isn\'t valid JSON of the form {"groups": {...}}',
    ]);
  });
});
