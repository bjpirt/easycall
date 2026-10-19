import { describe, expect, it } from "vitest";
import { parseMe } from "./me";

describe("parseMe", () => {
  it("accepts a valid response", () => {
    const me = { email: "ben@example.com", name: "Ben", role: "admin", receiverName: "Grandma" };

    expect(parseMe(me)).toEqual(me);
  });

  it.each([
    ["null", null],
    ["a missing email", { name: "Ben", role: "caller", receiverName: "Grandma" }],
    ["a missing name", { email: "a@x.com", role: "caller", receiverName: "Grandma" }],
    ["an unknown role", { email: "a@x.com", name: "A", role: "boss", receiverName: "Grandma" }],
    ["a missing receiver name", { email: "a@x.com", name: "A", role: "caller" }],
  ])("rejects %s", (_, value) => {
    expect(parseMe(value)).toBeUndefined();
  });
});
