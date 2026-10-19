import { beforeEach, describe, expect, it, vi } from "vitest";
import { directoryProblems, parseDirectory } from "./directory";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

const directoryOf = (groups: unknown) => parseDirectory(JSON.stringify({ groups }));
const receiver = (name = "Grandma") => ({ role: "receiver", name });

describe("parseDirectory", () => {
  it("finds groups by key, named after their receiver", () => {
    const directory = directoryOf({
      smith: { members: { "tablet@x.com": receiver("Grandma") } },
      "jones-2": { members: { "pad@x.com": receiver("Dad") } },
    });

    expect(directory.group("smith")).toEqual({ slug: "smith", receiverName: "Grandma" });
    expect(directory.group("jones-2")).toEqual({ slug: "jones-2", receiverName: "Dad" });
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
    ["an invalid key", "Smith Family", { members: { "a@x.com": receiver() } }],
    ["a key ending in a hyphen", "smith-", { members: { "a@x.com": receiver() } }],
    ["no members", "smith", {}],
    ["no receiver", "smith", { members: { "a@x.com": { role: "caller", name: "Ann" } } }],
    [
      "more than one receiver",
      "smith",
      { members: { "a@x.com": receiver("A"), "b@x.com": receiver("B") } },
    ],
  ])("skips a group with %s", (_, slug, group) => {
    const directory = directoryOf({
      [slug]: group,
      ok: { members: { "t@x.com": receiver("Mum") } },
    });

    expect(directory.group(slug)).toBeUndefined();
    expect(directory.group("ok")).toBeDefined();
  });

  describe("members", () => {
    const directory = directoryOf({
      smith: {
        members: {
          "Tablet@Example.com": receiver("Grandma"),
          "ben@example.com": { role: "admin", name: "  Ben " },
          "sis@example.com": { role: "caller", name: "Sarah" },
          "not-an-email": { role: "caller", name: "X" },
          "nameless@example.com": { role: "caller" },
          "blank@example.com": { role: "caller", name: " " },
          "bad@example.com": { role: "superuser", name: "Bad" },
          "old-format@example.com": "caller",
        },
      },
      jones: {
        members: {
          "pad@x.com": receiver("Dad"),
          "ben@example.com": { role: "caller", name: "Uncle Ben" },
        },
      },
    });

    it("looks up each member's role and name in a group", () => {
      expect(directory.member("smith", "tablet@example.com")).toEqual(receiver("Grandma"));
      expect(directory.member("smith", "ben@example.com")).toEqual({ role: "admin", name: "Ben" });
      expect(directory.member("smith", "sis@example.com")).toEqual({
        role: "caller",
        name: "Sarah",
      });
    });

    it("matches emails case-insensitively, ignoring surrounding spaces", () => {
      expect(directory.member("smith", " TABLET@example.COM ")?.role).toBe("receiver");
    });

    it("keeps someone in their first group only", () => {
      expect(directory.member("jones", "ben@example.com")).toBeUndefined();
      expect(directory.member("jones", "pad@x.com")).toEqual(receiver("Dad"));
    });

    it("finds the group someone is in", () => {
      expect(directory.groupOf("BEN@example.com")).toEqual({
        slug: "smith",
        receiverName: "Grandma",
      });
      expect(directory.groupOf("pad@x.com")).toEqual({ slug: "jones", receiverName: "Dad" });
    });

    it.each([
      ["a non-member", "stranger@example.com"],
      ["a skipped member", "bad@example.com"],
    ])("finds no group for %s", (_, email) => {
      expect(directory.groupOf(email)).toBeUndefined();
    });

    it.each([
      ["a non-member", "smith", "stranger@example.com"],
      ["a member of another group", "jones", "sis@example.com"],
      ["an invalid email", "smith", "not-an-email"],
      ["a member without a name", "smith", "nameless@example.com"],
      ["a member with a blank name", "smith", "blank@example.com"],
      ["an invalid role", "smith", "bad@example.com"],
      ["the old format (just a role)", "smith", "old-format@example.com"],
      ["an unknown group", "nobody", "ben@example.com"],
    ])("isn't found for %s", (_, slug, email) => {
      expect(directory.member(slug, email)).toBeUndefined();
    });
  });
});

describe("emails", () => {
  it("lists every member, normalised and sorted", () => {
    const directory = directoryOf({
      smith: {
        members: { "Zed@x.com": receiver(), "amy@x.com": { role: "admin", name: "Amy" } },
      },
      jones: {
        members: { "t@x.com": receiver("Dad"), "bob@x.com": { role: "caller", name: "Bob" } },
      },
    });

    expect(directory.emails()).toEqual(["amy@x.com", "bob@x.com", "t@x.com", "zed@x.com"]);
  });
});

describe("directoryProblems", () => {
  it("is empty for a valid directory", () => {
    expect(
      directoryProblems(
        JSON.stringify({ groups: { smith: { members: { "a@x.com": receiver() } } } }),
      ),
    ).toEqual([]);
  });

  it("describes every problem", () => {
    const json = JSON.stringify({
      groups: {
        "Bad Name": { members: { "a@x.com": receiver() } },
        empty: {},
        smith: {
          members: {
            "not-an-email": { role: "caller", name: "X" },
            "a@x.com": { role: "boss", name: "A" },
            "b@x.com": { role: "caller" },
            "r1@x.com": receiver("One"),
            "r2@x.com": receiver("Two"),
          },
        },
        jones: { members: { "t@x.com": receiver("Dad") } },
        brown: { members: { "T@x.com": { role: "caller", name: "T" }, "p@x.com": receiver() } },
      },
    });

    expect(directoryProblems(json)).toEqual([
      'group "Bad Name" isn\'t a valid URL name (lowercase letters, digits and hyphens)',
      'group "empty" needs exactly one receiver (it has 0)',
      'group "smith": "not-an-email" isn\'t an email address',
      'group "smith": a@x.com needs a role (receiver, caller or admin) and a name',
      'group "smith": b@x.com needs a role (receiver, caller or admin) and a name',
      'group "smith" needs exactly one receiver (it has 2)',
      'group "brown": T@x.com is already in group "jones" (one group per person)',
    ]);
  });

  it("reports JSON that isn't a directory", () => {
    expect(directoryProblems("[1, 2]")).toEqual([
      'it isn\'t valid JSON of the form {"groups": {...}}',
    ]);
  });
});
