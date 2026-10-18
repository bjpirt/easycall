import { describe, expect, it } from "vitest";
import { parseSignal, type Signal } from "./protocol";

describe("parseSignal", () => {
  const valid: Signal[] = [
    { type: "offer", sdp: "v=0..." },
    { type: "answer", sdp: "v=0..." },
    { type: "candidate", candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } },
    { type: "candidate", candidate: { candidate: "", sdpMid: null, sdpMLineIndex: null } },
  ];

  it.each(valid)("accepts $type", (signal) => {
    expect(parseSignal(JSON.stringify(signal))).toEqual(signal);
  });

  it("drops unknown fields", () => {
    expect(parseSignal(JSON.stringify({ type: "offer", sdp: "x", extra: 1 }))).toEqual({
      type: "offer",
      sdp: "x",
    });
  });

  it.each([
    ["non-JSON", "not json"],
    ["non-object", "42"],
    ["null", "null"],
    ["unknown type", JSON.stringify({ type: "hello" })],
    ["offer without sdp", JSON.stringify({ type: "offer" })],
    ["bad candidate", JSON.stringify({ type: "candidate", candidate: { candidate: 1 } })],
  ])("rejects %s", (_, raw) => {
    expect(parseSignal(raw)).toBeUndefined();
  });

  it("rejects binary messages", () => {
    expect(parseSignal(new ArrayBuffer(4))).toBeUndefined();
  });
});
