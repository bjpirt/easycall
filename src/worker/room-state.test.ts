import { describe, expect, it } from "vitest";
import type { Message } from "../shared/protocol";
import {
  connect,
  disconnect,
  emptyRoom,
  expire,
  receive,
  status,
  type Connection,
  type RoomState,
  type TimerName,
} from "./room-state";

const receiver: Connection = { id: "r", role: "receiver", email: "tablet@x.com", name: "Grandma" };
const alice: Connection = { id: "a", role: "caller", email: "alice@x.com", name: "Alice" };
const bob: Connection = { id: "b", role: "caller", email: "bob@x.com", name: "Bob" };
const offer: Message = { type: "offer", sdp: "OFFER" };

const participant = (email: string, name: string, connection: string | null) => ({
  email,
  name,
  connection,
});
const tablet = participant("tablet@x.com", "Grandma", "r");
const tabletAway = participant("tablet@x.com", "Grandma", null);
const aliceInCall = participant("alice@x.com", "Alice", "a");
const aliceAway = participant("alice@x.com", "Alice", null);

const room = (overrides: Partial<RoomState>): RoomState => ({ ...emptyRoom, ...overrides });
const sendTo = (to: string, message: Message) => ({ type: "send", to, message });
const statusTo = (to: string, s: string, caller?: string) =>
  sendTo(
    to,
    (caller ? { type: "status", status: s, caller } : { type: "status", status: s }) as Message,
  );
const welcome = (to: string, resumed: boolean) =>
  sendTo(to, { type: "welcome", resumed, version: "test-version" });
const timer = (name: TimerName, running: boolean) => ({ type: "timer", name, running });
const close = (id: string, reason: string) => ({ type: "close", id, reason });

describe("status", () => {
  it.each([
    [room({}), "unavailable"],
    [room({ callers: ["a"] }), "unavailable"],
    [room({ receiver: tablet }), "available"],
    [room({ receiver: tabletAway }), "available"], // briefly away still counts
    [room({ receiver: tablet, callers: ["a"], active: aliceInCall }), "in-call"],
  ])("%o is %s", (state, expected) => {
    expect(status(state)).toBe(expected);
  });
});

describe("connect", () => {
  it("welcomes a new caller and tells them the status", () => {
    const { state, effects } = connect(room({ receiver: tablet }), alice);

    expect(state.callers).toEqual(["a"]);
    expect(effects).toEqual([welcome("a", false), statusTo("a", "available")]);
  });

  it("a receiver joining makes the room available and starts the ready window", () => {
    const { state, effects } = connect(room({ callers: ["a", "b"] }), receiver);

    expect(state.receiver).toEqual(tablet);
    expect(effects).toEqual([
      welcome("r", false),
      statusTo("a", "available"),
      statusTo("b", "available"),
      timer("ready", true),
    ]);
  });

  it("a different receiver replaces the old one, ends its call and restarts the window", () => {
    const before = room({
      receiver: participant("old@x.com", "Old", "old"),
      callers: ["a"],
      active: aliceInCall,
    });

    const { state, effects } = connect(before, receiver);

    expect(state).toEqual(room({ receiver: tablet, callers: ["a"] }));
    expect(effects).toEqual([
      welcome("r", false),
      close("old", "Replaced by a newer connection"),
      sendTo("a", { type: "hangup" }),
      statusTo("a", "available"),
      timer("ready", true),
    ]);
  });
});

describe("join", () => {
  it("puts the caller in the call when the receiver is available", () => {
    const { state, effects } = receive(room({ receiver: tablet, callers: ["a", "b"] }), alice, {
      type: "join",
    });

    expect(state.active).toEqual(aliceInCall);
    expect(effects).toEqual([
      sendTo("a", { type: "joined" }),
      sendTo("r", { type: "incoming", name: "Alice" }),
      statusTo("a", "in-call", "Alice"),
      statusTo("b", "in-call", "Alice"),
      timer("ready", false),
    ]);
  });

  it.each([
    ["there's no receiver", room({ callers: ["a"] })],
    ["the receiver is reconnecting", room({ receiver: tabletAway, callers: ["a"] })],
    [
      "someone else is in the call",
      room({ receiver: tablet, callers: ["a", "b"], active: participant("bob@x.com", "Bob", "b") }),
    ],
  ])("is refused when %s", (_, before) => {
    expect(receive(before, alice, { type: "join" })).toEqual({
      state: before,
      effects: [sendTo("a", { type: "refused" })],
    });
  });

  it("is ignored from the caller already in the call, or from the receiver", () => {
    const inCall = room({ receiver: tablet, callers: ["a"], active: aliceInCall });

    expect(receive(inCall, alice, { type: "join" }).effects).toEqual([]);
    expect(receive(room({ receiver: tablet }), receiver, { type: "join" }).effects).toEqual([]);
  });
});

describe("hangup", () => {
  const inCall = room({ receiver: tablet, callers: ["a", "b"], active: aliceInCall });

  it("from the active caller ends the call and sends the receiver back to idle", () => {
    const { state, effects } = receive(inCall, alice, { type: "hangup" });

    expect(state).toEqual(room({ callers: ["a", "b"] }));
    expect(effects).toEqual([
      sendTo("r", { type: "hangup" }),
      close("r", "The call has ended"),
      statusTo("a", "unavailable"),
      statusTo("b", "unavailable"),
    ]);
  });

  it("from anyone else is ignored", () => {
    expect(receive(inCall, bob, { type: "hangup" })).toEqual({ state: inCall, effects: [] });
  });
});

describe("signals", () => {
  const inCall = room({ receiver: tablet, callers: ["a", "b"], active: aliceInCall });

  it("go from the active caller to the receiver", () => {
    expect(receive(inCall, alice, offer).effects).toEqual([sendTo("r", offer)]);
  });

  it("go from the receiver to the active caller", () => {
    const answer: Message = { type: "answer", sdp: "ANSWER" };

    expect(receive(inCall, receiver, answer).effects).toEqual([sendTo("a", answer)]);
  });

  it.each([
    ["a caller who isn't in the call", inCall, bob],
    ["the receiver with no call", room({ receiver: tablet }), receiver],
    [
      "a replaced receiver",
      inCall,
      { id: "old", role: "receiver", email: "tablet@x.com", name: "Grandma" },
    ],
  ] as [string, RoomState, Connection][])("from %s are dropped", (_, state, from) => {
    expect(receive(state, from, offer).effects).toEqual([]);
  });

  it("to someone who's reconnecting are dropped", () => {
    const away = room({ receiver: tablet, callers: [], active: aliceAway });

    expect(receive(away, receiver, offer).effects).toEqual([]);
  });
});

it("ignores room-only messages sent by clients", () => {
  const before = room({ receiver: tablet, callers: ["a"] });

  for (const message of [
    { type: "status", status: "available" },
    { type: "joined" },
    { type: "refused" },
    { type: "timeout" },
    { type: "welcome", resumed: true, version: "x" },
  ] as Message[]) {
    expect(receive(before, alice, message).effects).toEqual([]);
  }
});

describe("a dropped connection (no hang-up)", () => {
  it("a caller who isn't in the call is just forgotten", () => {
    const { state, effects } = disconnect(room({ receiver: tablet, callers: ["a", "b"] }), alice);

    expect(state.callers).toEqual(["b"]);
    expect(effects).toEqual([]);
  });

  it("the active caller's place is held and the call carries on", () => {
    const { state, effects } = disconnect(
      room({ receiver: tablet, callers: ["a", "b"], active: aliceInCall }),
      alice,
    );

    expect(state).toEqual(room({ receiver: tablet, callers: ["b"], active: aliceAway }));
    expect(effects).toEqual([timer("caller-away", true)]);
  });

  it("the receiver's place is held and they still show as available", () => {
    const { state, effects } = disconnect(room({ receiver: tablet, callers: ["a"] }), receiver);

    expect(state.receiver).toEqual(tabletAway);
    expect(effects).toEqual([timer("receiver-away", true)]);
  });

  it("a replaced receiver leaving changes nothing", () => {
    const before = room({ receiver: tablet, callers: ["a"] });

    expect(
      disconnect(before, { id: "old", role: "receiver", email: "tablet@x.com", name: "Grandma" }),
    ).toEqual({
      state: before,
      effects: [],
    });
  });
});

describe("reconnecting", () => {
  it("the active caller gets their place in the call back", () => {
    const before = room({ receiver: tablet, callers: ["b"], active: aliceAway });

    const { state, effects } = connect(before, { ...alice, id: "a2" });

    expect(state).toEqual(
      room({
        receiver: tablet,
        callers: ["b", "a2"],
        active: participant("alice@x.com", "Alice", "a2"),
      }),
    );
    expect(effects).toEqual([
      welcome("a2", true),
      statusTo("a2", "in-call", "Alice"),
      timer("caller-away", false),
    ]);
  });

  it("someone else connecting as a caller doesn't take the away caller's place", () => {
    const before = room({ receiver: tablet, callers: [], active: aliceAway });

    const { state, effects } = connect(before, bob);

    expect(state.active).toEqual(aliceAway);
    expect(effects).toEqual([welcome("b", false), statusTo("b", "in-call", "Alice")]);
  });

  it("the receiver gets their place back, call and all", () => {
    const before = room({ receiver: tabletAway, callers: ["a"], active: aliceInCall });

    const { state, effects } = connect(before, { ...receiver, id: "r2" });

    expect(state).toEqual(
      room({
        receiver: participant("tablet@x.com", "Grandma", "r2"),
        callers: ["a"],
        active: aliceInCall,
      }),
    );
    expect(effects).toEqual([
      welcome("r2", true),
      sendTo("r2", { type: "incoming", name: "Alice" }), // so a reloaded tablet knows who's calling
      timer("receiver-away", false),
    ]);
  });

  it("the receiver reloading replaces their old connection but keeps their place", () => {
    const before = room({ receiver: tablet, callers: ["a"] });

    const { state, effects } = connect(before, { ...receiver, id: "r2" });

    expect(state.receiver).toEqual(participant("tablet@x.com", "Grandma", "r2"));
    expect(effects).toEqual([welcome("r2", true), close("r", "Replaced by a newer connection")]);
  });
});

describe("timers running out", () => {
  it("ready: sends a waiting receiver away and tells callers they're unavailable", () => {
    const { state, effects } = expire(room({ receiver: tablet, callers: ["a"] }), "ready");

    expect(state).toEqual(room({ callers: ["a"] }));
    expect(effects).toEqual([
      sendTo("r", { type: "timeout" }),
      close("r", "No calls within the ready window"),
      statusTo("a", "unavailable"),
      timer("ready", false),
    ]);
  });

  it("ready: also clears a receiver who was away", () => {
    const { state, effects } = expire(room({ receiver: tabletAway, callers: ["a"] }), "ready");

    expect(state.receiver).toBeNull();
    expect(effects).toEqual([
      statusTo("a", "unavailable"),
      timer("ready", false),
      timer("receiver-away", false),
    ]);
  });

  it("receiver-away: the receiver didn't come back, so they're gone and the call ends", () => {
    const before = room({ receiver: tabletAway, callers: ["a", "b"], active: aliceInCall });

    const { state, effects } = expire(before, "receiver-away");

    expect(state).toEqual(room({ callers: ["a", "b"] }));
    expect(effects).toEqual([
      sendTo("a", { type: "hangup" }),
      statusTo("a", "unavailable"),
      statusTo("b", "unavailable"),
      timer("receiver-away", false),
    ]);
  });

  it("caller-away: the caller didn't come back, so the call ends", () => {
    const before = room({ receiver: tablet, callers: ["b"], active: aliceAway });

    const { state, effects } = expire(before, "caller-away");

    expect(state).toEqual(room({ callers: ["b"] }));
    expect(effects).toEqual([
      sendTo("r", { type: "hangup" }),
      close("r", "The call has ended"),
      statusTo("b", "unavailable"),
      timer("caller-away", false),
    ]);
  });

  it.each([
    ["ready", "during a call", room({ receiver: tablet, callers: ["a"], active: aliceInCall })],
    ["ready", "with no receiver", room({ callers: ["a"] })],
    ["receiver-away", "once the receiver is back", room({ receiver: tablet })],
    ["caller-away", "once the caller is back", room({ receiver: tablet, active: aliceInCall })],
  ] as [TimerName, string, RoomState][])("%s does nothing %s", (name, _, before) => {
    expect(expire(before, name)).toEqual({ state: before, effects: [] });
  });
});
