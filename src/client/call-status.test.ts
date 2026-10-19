import { describe, expect, it } from "vitest";
import { callNotice, mediaState } from "./call-status";

describe("mediaState", () => {
  it.each([
    ["connected", false, "connected"],
    ["disconnected", false, "connecting"],
    ["failed", false, "connecting"],
    ["disconnected", true, "interrupted"],
    ["failed", true, "interrupted"],
    ["connecting", false, undefined],
    ["new", false, undefined],
    ["closed", true, undefined],
  ] as const)("%s (connected before: %s) is %s", (state, before, expected) => {
    expect(mediaState(state, before)).toBe(expected);
  });
});

describe("callNotice", () => {
  it.each([
    ["connecting", false, "Connecting…"],
    ["connected", false, undefined],
    ["interrupted", false, "Reconnecting…"],
    ["connected", true, "Reconnecting…"],
    ["connecting", true, "Reconnecting…"],
  ] as const)("media %s, room reconnecting %s → %s", (media, reconnecting, expected) => {
    expect(callNotice(media, reconnecting)).toBe(expected);
  });
});
