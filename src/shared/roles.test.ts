import { describe, expect, it } from "vitest";
import { isMemberRole, isRole, roomRole } from "./roles";

describe("roles", () => {
  it.each([
    ["receiver", true, true],
    ["caller", true, true],
    ["admin", false, true],
    ["intruder", false, false],
    [undefined, false, false],
  ])("%s: room role %s, member role %s", (value, room, member) => {
    expect(isRole(value)).toBe(room);
    expect(isMemberRole(value)).toBe(member);
  });

  it("admins join the room as callers", () => {
    expect(roomRole("admin")).toBe("caller");
    expect(roomRole("caller")).toBe("caller");
    expect(roomRole("receiver")).toBe("receiver");
  });
});
