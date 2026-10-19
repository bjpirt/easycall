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

const receiver: Connection = {
  id: "r",
  role: "receiver",
  email: "tablet@x.com",
  name: "Grandma",
  page: "pr",
};
const alice: Connection = {
  id: "a",
  role: "caller",
  email: "alice@x.com",
  name: "Alice",
  page: "pa",
};
const bob: Connection = { id: "b", role: "caller", email: "bob@x.com", name: "Bob", page: "pb" };
/** Alice again, on another page (e.g. the app closed and reopened, or another device). */
const aliceAgain: Connection = { ...alice, id: "a2", page: "pa2" };
const offer: Message = { type: "offer", sdp: "OFFER" };

const participant = (email: string, name: string, connection: string | null) => ({
  email,
  name,
  connection,
});
const tablet = participant("tablet@x.com", "Grandma", "r");
const tabletAway = participant("tablet@x.com", "Grandma", null);
const aliceInCall = { ...participant("alice@x.com", "Alice", "a"), page: "pa", call: "a" };
const aliceAway = { ...aliceInCall, connection: null };
const callers = (...connections: Connection[]) =>
  connections.map(({ id, email }) => ({ id, email }));

const room = (overrides: Partial<RoomState>): RoomState => ({ ...emptyRoom, ...overrides });
const sendTo = (to: string, message: Message) => ({ type: "send", to, message });
const statusTo = (to: string, s: string, caller?: string, rejoin?: true) =>
  sendTo(
    to,
    (caller
      ? { type: "status", status: s, caller, ...(rejoin && { rejoin }) }
      : { type: "status", status: s }) as Message,
  );
const welcome = (to: string, resumed: boolean) =>
  sendTo(to, { type: "welcome", resumed, version: "test-version" });
const timer = (name: TimerName, running: boolean) => ({ type: "timer", name, running });
const close = (id: string, reason: string) => ({ type: "close", id, reason });

describe("status", () => {
  it.each([
    [room({}), "unavailable"],
    [room({ callers: callers(alice) }), "unavailable"],
    [room({ receiver: tablet }), "available"],
    [room({ receiver: tabletAway }), "available"], // briefly away still counts
    [room({ receiver: tablet, callers: callers(alice), active: aliceInCall }), "in-call"],
  ])("%o is %s", (state, expected) => {
    expect(status(state)).toBe(expected);
  });
});

describe("connect", () => {
  it("welcomes a new caller and tells them the status", () => {
    const { state, effects } = connect(room({ receiver: tablet }), alice);

    expect(state.callers).toEqual(callers(alice));
    expect(effects).toEqual([welcome("a", false), statusTo("a", "available")]);
  });

  it("a receiver joining makes the room available and starts the ready window", () => {
    const { state, effects } = connect(room({ callers: callers(alice, bob) }), receiver);

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
      callers: callers(alice),
      active: aliceInCall,
    });

    const { state, effects } = connect(before, receiver);

    expect(state).toEqual(room({ receiver: tablet, callers: callers(alice) }));
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
    const { state, effects } = receive(
      room({ receiver: tablet, callers: callers(alice, bob) }),
      alice,
      {
        type: "join",
      },
    );

    expect(state.active).toEqual(aliceInCall);
    expect(effects).toEqual([
      sendTo("a", { type: "joined" }),
      sendTo("r", { type: "incoming", name: "Alice", call: "a" }),
      statusTo("a", "in-call", "Alice"),
      statusTo("b", "in-call", "Alice"),
      timer("ready", false),
    ]);
  });

  it.each([
    ["there's no receiver", room({ callers: callers(alice) })],
    ["the receiver is reconnecting", room({ receiver: tabletAway, callers: callers(alice) })],
    [
      "someone else is in the call",
      room({
        receiver: tablet,
        callers: callers(alice, bob),
        active: { ...participant("bob@x.com", "Bob", "b"), page: "pb", call: "b" },
      }),
    ],
  ])("is refused when %s", (_, before) => {
    expect(receive(before, alice, { type: "join" })).toEqual({
      state: before,
      effects: [sendTo("a", { type: "refused" })],
    });
  });

  it("lets the caller back into their dropped call from another page, as a new call", () => {
    const before = room({ receiver: tablet, callers: callers(aliceAgain, bob), active: aliceAway });

    const { state, effects } = receive(before, aliceAgain, { type: "join" });

    expect(state.active).toEqual({
      ...participant("alice@x.com", "Alice", "a2"),
      page: "pa2",
      call: "a2",
    });
    expect(effects).toEqual([
      sendTo("a2", { type: "joined" }),
      sendTo("r", { type: "incoming", name: "Alice", call: "a2" }),
      statusTo("a2", "in-call", "Alice"), // no longer theirs to rejoin
      timer("caller-away", false),
    ]);
  });

  it("is refused to anyone else while the caller in the call is away", () => {
    const before = room({ receiver: tablet, callers: callers(bob), active: aliceAway });

    expect(receive(before, bob, { type: "join" }).effects).toEqual([
      sendTo("b", { type: "refused" }),
    ]);
  });

  it("is ignored from the caller already in the call, or from the receiver", () => {
    const inCall = room({ receiver: tablet, callers: callers(alice), active: aliceInCall });

    expect(receive(inCall, alice, { type: "join" }).effects).toEqual([]);
    expect(receive(room({ receiver: tablet }), receiver, { type: "join" }).effects).toEqual([]);
  });
});

describe("hangup", () => {
  const inCall = room({ receiver: tablet, callers: callers(alice, bob), active: aliceInCall });

  it("from the active caller ends the call and sends the receiver back to idle", () => {
    const { state, effects } = receive(inCall, alice, { type: "hangup" });

    expect(state).toEqual(room({ callers: callers(alice, bob) }));
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
  const inCall = room({ receiver: tablet, callers: callers(alice, bob), active: aliceInCall });

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
    ["a replaced receiver", inCall, { ...receiver, id: "old", page: "old" }],
  ] as [string, RoomState, Connection][])("from %s are dropped", (_, state, from) => {
    expect(receive(state, from, offer).effects).toEqual([]);
  });

  it("to someone who's reconnecting are dropped", () => {
    const away = room({ receiver: tablet, callers: [], active: aliceAway });

    expect(receive(away, receiver, offer).effects).toEqual([]);
  });
});

it("ignores room-only messages sent by clients", () => {
  const before = room({ receiver: tablet, callers: callers(alice) });

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
    const { state, effects } = disconnect(
      room({ receiver: tablet, callers: callers(alice, bob) }),
      alice,
    );

    expect(state.callers).toEqual(callers(bob));
    expect(effects).toEqual([]);
  });

  it("the active caller's place is held and the call carries on", () => {
    const { state, effects } = disconnect(
      room({ receiver: tablet, callers: callers(alice, bob), active: aliceInCall }),
      alice,
    );

    expect(state).toEqual(room({ receiver: tablet, callers: callers(bob), active: aliceAway }));
    expect(effects).toEqual([timer("caller-away", true)]);
  });

  it("tells the active caller's other pages they can rejoin, and nobody else", () => {
    const before = room({
      receiver: tablet,
      callers: callers(alice, aliceAgain, bob),
      active: aliceInCall,
    });

    const { effects } = disconnect(before, alice);

    expect(effects).toEqual([statusTo("a2", "in-call", "Alice", true), timer("caller-away", true)]);
  });

  it("the receiver's place is held and they still show as available", () => {
    const { state, effects } = disconnect(
      room({ receiver: tablet, callers: callers(alice) }),
      receiver,
    );

    expect(state.receiver).toEqual(tabletAway);
    expect(effects).toEqual([timer("receiver-away", true)]);
  });

  it("a replaced receiver leaving changes nothing", () => {
    const before = room({ receiver: tablet, callers: callers(alice) });

    expect(disconnect(before, { ...receiver, id: "old", page: "old" })).toEqual({
      state: before,
      effects: [],
    });
  });
});

describe("reconnecting", () => {
  it("the active caller's page gets its place in the call back", () => {
    const before = room({ receiver: tablet, callers: callers(bob), active: aliceAway });

    const { state, effects } = connect(before, { ...alice, id: "a2" });

    expect(state).toEqual(
      room({
        receiver: tablet,
        callers: [...callers(bob), { id: "a2", email: "alice@x.com" }],
        active: { ...aliceInCall, connection: "a2" },
      }),
    );
    expect(effects).toEqual([
      welcome("a2", true),
      statusTo("a2", "in-call", "Alice"),
      timer("caller-away", false),
    ]);
  });

  it("the active caller on another page doesn't get their place, but can rejoin", () => {
    const before = room({ receiver: tablet, callers: callers(bob), active: aliceAway });

    const { state, effects } = connect(before, aliceAgain);

    expect(state.active).toEqual(aliceAway);
    expect(effects).toEqual([welcome("a2", false), statusTo("a2", "in-call", "Alice", true)]);
  });

  it("the active caller's old page doesn't get its place back once they've rejoined", () => {
    const rejoined = { ...aliceInCall, connection: "a2", page: "pa2", call: "a2" };
    const before = room({ receiver: tablet, callers: callers(aliceAgain), active: rejoined });

    const { state, effects } = connect(before, { ...alice, id: "a3" });

    expect(state.active).toEqual(rejoined);
    expect(effects).toEqual([welcome("a3", false), statusTo("a3", "in-call", "Alice")]);
  });

  it("someone else connecting as a caller doesn't take the away caller's place", () => {
    const before = room({ receiver: tablet, callers: [], active: aliceAway });

    const { state, effects } = connect(before, bob);

    expect(state.active).toEqual(aliceAway);
    expect(effects).toEqual([welcome("b", false), statusTo("b", "in-call", "Alice")]);
  });

  it("the receiver gets their place back, call and all", () => {
    const before = room({ receiver: tabletAway, callers: callers(alice), active: aliceInCall });

    const { state, effects } = connect(before, { ...receiver, id: "r2" });

    expect(state).toEqual(
      room({
        receiver: participant("tablet@x.com", "Grandma", "r2"),
        callers: callers(alice),
        active: aliceInCall,
      }),
    );
    expect(effects).toEqual([
      welcome("r2", true),
      sendTo("r2", { type: "incoming", name: "Alice", call: "a" }), // so a reloaded tablet knows who's calling
      timer("receiver-away", false),
    ]);
  });

  it("the receiver reloading replaces their old connection but keeps their place", () => {
    const before = room({ receiver: tablet, callers: callers(alice) });

    const { state, effects } = connect(before, { ...receiver, id: "r2" });

    expect(state.receiver).toEqual(participant("tablet@x.com", "Grandma", "r2"));
    expect(effects).toEqual([welcome("r2", true), close("r", "Replaced by a newer connection")]);
  });
});

describe("timers running out", () => {
  it("ready: sends a waiting receiver away and tells callers they're unavailable", () => {
    const { state, effects } = expire(room({ receiver: tablet, callers: callers(alice) }), "ready");

    expect(state).toEqual(room({ callers: callers(alice) }));
    expect(effects).toEqual([
      sendTo("r", { type: "timeout" }),
      close("r", "No calls within the ready window"),
      statusTo("a", "unavailable"),
      timer("ready", false),
    ]);
  });

  it("ready: also clears a receiver who was away", () => {
    const { state, effects } = expire(
      room({ receiver: tabletAway, callers: callers(alice) }),
      "ready",
    );

    expect(state.receiver).toBeNull();
    expect(effects).toEqual([
      statusTo("a", "unavailable"),
      timer("ready", false),
      timer("receiver-away", false),
    ]);
  });

  it("receiver-away: the receiver didn't come back, so they're gone and the call ends", () => {
    const before = room({
      receiver: tabletAway,
      callers: callers(alice, bob),
      active: aliceInCall,
    });

    const { state, effects } = expire(before, "receiver-away");

    expect(state).toEqual(room({ callers: callers(alice, bob) }));
    expect(effects).toEqual([
      sendTo("a", { type: "hangup" }),
      statusTo("a", "unavailable"),
      statusTo("b", "unavailable"),
      timer("receiver-away", false),
    ]);
  });

  it("caller-away: the caller didn't come back, so the call ends", () => {
    const before = room({ receiver: tablet, callers: callers(bob), active: aliceAway });

    const { state, effects } = expire(before, "caller-away");

    expect(state).toEqual(room({ callers: callers(bob) }));
    expect(effects).toEqual([
      sendTo("r", { type: "hangup" }),
      close("r", "The call has ended"),
      statusTo("b", "unavailable"),
      timer("caller-away", false),
    ]);
  });

  it.each([
    [
      "ready",
      "during a call",
      room({ receiver: tablet, callers: callers(alice), active: aliceInCall }),
    ],
    ["ready", "with no receiver", room({ callers: callers(alice) })],
    ["receiver-away", "once the receiver is back", room({ receiver: tablet })],
    ["caller-away", "once the caller is back", room({ receiver: tablet, active: aliceInCall })],
  ] as [TimerName, string, RoomState][])("%s does nothing %s", (name, _, before) => {
    expect(expire(before, name)).toEqual({ state: before, effects: [] });
  });
});
