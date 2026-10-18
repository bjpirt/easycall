import { describe, expect, it } from "vitest";
import { parseMe } from "./me";

describe("parseMe", () => {
  it("accepts a valid response", () => {
    const me = { email: "ben@example.com", role: "admin", displayName: "Grandma" };

    expect(parseMe(me)).toEqual(me);
  });

  it.each([
    ["null", null],
    ["a missing email", { role: "caller", displayName: "Grandma" }],
    ["an unknown role", { email: "a@x.com", role: "boss", displayName: "Grandma" }],
    ["a missing display name", { email: "a@x.com", role: "caller" }],
  ])("rejects %s", (_, value) => {
    expect(parseMe(value)).toBeUndefined();
  });
});
