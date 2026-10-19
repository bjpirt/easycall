import { describe, expect, it } from "vitest";
import { parseMessage, type Message } from "./protocol";

describe("parseMessage", () => {
  const valid: Message[] = [
    { type: "offer", sdp: "v=0..." },
    { type: "answer", sdp: "v=0..." },
    { type: "candidate", candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } },
    { type: "candidate", candidate: { candidate: "", sdpMid: null, sdpMLineIndex: null } },
    { type: "hangup" },
    { type: "join" },
    { type: "joined" },
    { type: "refused" },
    { type: "timeout" },
    { type: "welcome", resumed: true, version: "abc123" },
    { type: "welcome", resumed: false, version: "abc123" },
    { type: "status", status: "unavailable" },
    { type: "status", status: "available" },
    { type: "status", status: "in-call" },
    { type: "status", status: "in-call", caller: "Ben" },
    { type: "status", status: "in-call", caller: "Ben", rejoin: true },
    { type: "incoming", name: "Ben", call: "c1" },
  ];

  it.each(valid)("accepts $type", (message) => {
    expect(parseMessage(JSON.stringify(message))).toEqual(message);
  });

  it("drops unknown fields", () => {
    expect(parseMessage(JSON.stringify({ type: "offer", sdp: "x", extra: 1 }))).toEqual({
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
    ["unknown status", JSON.stringify({ type: "status", status: "asleep" })],
    ["welcome without resumed", JSON.stringify({ type: "welcome", version: "v" })],
    ["welcome without a version", JSON.stringify({ type: "welcome", resumed: false })],
    ["incoming without a name", JSON.stringify({ type: "incoming", call: "c1" })],
    ["incoming without a call", JSON.stringify({ type: "incoming", name: "Ben" })],
  ])("rejects %s", (_, raw) => {
    expect(parseMessage(raw)).toBeUndefined();
  });

  it("rejects binary messages", () => {
    expect(parseMessage(new ArrayBuffer(4))).toBeUndefined();
  });
});
