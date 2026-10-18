import { describe, expect, it } from "vitest";
import type { Message } from "../shared/protocol";
import {
  connect,
  disconnect,
  emptyRoom,
  receive,
  status,
  timeout,
  type Connection,
  type RoomState,
} from "./room-state";

const receiver: Connection = { id: "r", role: "receiver" };
const alice: Connection = { id: "a", role: "caller" };
const bob: Connection = { id: "b", role: "caller" };
const offer: Message = { type: "offer", sdp: "OFFER" };

const room = (overrides: Partial<RoomState>): RoomState => ({ ...emptyRoom, ...overrides });
const timer = (running: boolean) => ({ type: "timer", running });
const statusTo = (to: string, s: string) => ({
  type: "send",
  to,
  message: { type: "status", status: s },
});

describe("status", () => {
  it.each([
    [room({}), "unavailable"],
    [room({ callers: ["a"] }), "unavailable"],
    [room({ receiver: "r" }), "available"],
    [room({ receiver: "r", callers: ["a"], active: "a" }), "in-call"],
  ])("%o is %s", (state, expected) => {
    expect(status(state)).toBe(expected);
  });
});

describe("connect", () => {
  it("tells a new caller the current status", () => {
    const { state, effects } = connect(room({ receiver: "r" }), alice);

    expect(state.callers).toEqual(["a"]);
    expect(effects).toEqual([statusTo("a", "available")]);
  });

  it("a receiver joining makes the room available to all callers", () => {
    const { state, effects } = connect(room({ callers: ["a", "b"] }), receiver);

    expect(state.receiver).toBe("r");
    expect(effects).toEqual([statusTo("a", "available"), statusTo("b", "available"), timer(true)]);
  });

  it("a new receiver replaces the old one and ends its call", () => {
    const before = room({ receiver: "old", callers: ["a"], active: "a" });

    const { state, effects } = connect(before, receiver);

    expect(state).toEqual(room({ receiver: "r", callers: ["a"] }));
    expect(effects).toEqual([
      { type: "close", id: "old", reason: "Replaced by a newer connection" },
      { type: "send", to: "a", message: { type: "hangup" } },
      statusTo("a", "available"),
      timer(true),
    ]);
  });

  it("a replacement receiver restarts the ready window", () => {
    const { effects } = connect(room({ receiver: "old" }), receiver);

    expect(effects).toEqual([
      { type: "close", id: "old", reason: "Replaced by a newer connection" },
      timer(true),
    ]);
  });
});

describe("join", () => {
  it("puts the caller in the call when the receiver is available", () => {
    const { state, effects } = receive(room({ receiver: "r", callers: ["a", "b"] }), alice, {
      type: "join",
    });

    expect(state.active).toBe("a");
    expect(effects).toEqual([
      { type: "send", to: "a", message: { type: "joined" } },
      statusTo("a", "in-call"),
      statusTo("b", "in-call"),
      timer(false),
    ]);
  });

  it.each([
    ["there's no receiver", room({ callers: ["a"] })],
    ["someone else is in the call", room({ receiver: "r", callers: ["a", "b"], active: "b" })],
  ])("is refused when %s", (_, before) => {
    expect(receive(before, alice, { type: "join" })).toEqual({
      state: before,
      effects: [{ type: "send", to: "a", message: { type: "refused" } }],
    });
  });

  it("is ignored from the caller already in the call", () => {
    const before = room({ receiver: "r", callers: ["a"], active: "a" });

    expect(receive(before, alice, { type: "join" })).toEqual({ state: before, effects: [] });
  });

  it("is ignored from the receiver", () => {
    const before = room({ receiver: "r" });

    expect(receive(before, receiver, { type: "join" })).toEqual({ state: before, effects: [] });
  });
});

describe("hangup", () => {
  const inCall = room({ receiver: "r", callers: ["a", "b"], active: "a" });

  it("from the active caller ends the call and tells the receiver", () => {
    const { state, effects } = receive(inCall, alice, { type: "hangup" });

    expect(state.active).toBeNull();
    expect(effects).toEqual([
      { type: "send", to: "r", message: { type: "hangup" } },
      statusTo("a", "available"),
      statusTo("b", "available"),
      timer(true),
    ]);
  });

  it("from anyone else is ignored", () => {
    expect(receive(inCall, bob, { type: "hangup" })).toEqual({ state: inCall, effects: [] });
  });
});

describe("signals", () => {
  const inCall = room({ receiver: "r", callers: ["a", "b"], active: "a" });

  it("go from the active caller to the receiver", () => {
    expect(receive(inCall, alice, offer).effects).toEqual([
      { type: "send", to: "r", message: offer },
    ]);
  });

  it("go from the receiver to the active caller", () => {
    const answer: Message = { type: "answer", sdp: "ANSWER" };

    expect(receive(inCall, receiver, answer).effects).toEqual([
      { type: "send", to: "a", message: answer },
    ]);
  });

  it("from a caller who isn't in the call are dropped", () => {
    expect(receive(inCall, bob, offer).effects).toEqual([]);
  });

  it("from the receiver with no call are dropped", () => {
    expect(receive(room({ receiver: "r" }), receiver, offer).effects).toEqual([]);
  });
});

it("ignores room-only messages sent by clients", () => {
  const before = room({ receiver: "r", callers: ["a"] });

  expect(receive(before, alice, { type: "status", status: "available" }).effects).toEqual([]);
  expect(receive(before, alice, { type: "joined" }).effects).toEqual([]);
  expect(receive(before, alice, { type: "refused" }).effects).toEqual([]);
});

describe("disconnect", () => {
  it("a caller leaving is forgotten", () => {
    const { state, effects } = disconnect(room({ receiver: "r", callers: ["a", "b"] }), alice);

    expect(state.callers).toEqual(["b"]);
    expect(effects).toEqual([]);
  });

  it("the active caller leaving ends the call", () => {
    const { state, effects } = disconnect(
      room({ receiver: "r", callers: ["a", "b"], active: "a" }),
      alice,
    );

    expect(state).toEqual(room({ receiver: "r", callers: ["b"] }));
    expect(effects).toEqual([
      { type: "send", to: "r", message: { type: "hangup" } },
      statusTo("b", "available"),
      timer(true),
    ]);
  });

  it("the receiver leaving makes the room unavailable and ends any call", () => {
    const { state, effects } = disconnect(
      room({ receiver: "r", callers: ["a", "b"], active: "a" }),
      receiver,
    );

    expect(state).toEqual(room({ callers: ["a", "b"] }));
    expect(effects).toEqual([
      { type: "send", to: "a", message: { type: "hangup" } },
      statusTo("a", "unavailable"),
      statusTo("b", "unavailable"),
    ]);
  });

  it("a waiting receiver leaving stops the ready window", () => {
    const { effects } = disconnect(room({ receiver: "r", callers: ["a"] }), receiver);

    expect(effects).toEqual([statusTo("a", "unavailable"), timer(false)]);
  });

  it("a replaced receiver leaving changes nothing", () => {
    const before = room({ receiver: "r", callers: ["a"] });

    expect(disconnect(before, { id: "old", role: "receiver" })).toEqual({
      state: before,
      effects: [],
    });
  });
});

describe("timeout", () => {
  it("sends a waiting receiver away and tells callers they're unavailable", () => {
    const { state, effects } = timeout(room({ receiver: "r", callers: ["a"] }));

    expect(state).toEqual(room({ callers: ["a"] }));
    expect(effects).toEqual([
      { type: "send", to: "r", message: { type: "timeout" } },
      { type: "close", id: "r", reason: "No calls within the ready window" },
      statusTo("a", "unavailable"),
      timer(false),
    ]);
  });

  it.each([
    ["during a call", room({ receiver: "r", callers: ["a"], active: "a" })],
    ["with no receiver", room({ callers: ["a"] })],
  ])("does nothing %s", (_, before) => {
    expect(timeout(before)).toEqual({ state: before, effects: [] });
  });
});
