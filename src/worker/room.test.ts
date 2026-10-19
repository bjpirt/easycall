import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMessage, type Message } from "../shared/protocol";
import { graceMs, readyWindowMs, timerMs, type Room } from "./room";
import type { TimerName } from "./room-state";

/** A test WebSocket client that records every valid message it receives. */
class Client {
  readonly messages: Message[] = [];
  readonly closed: Promise<void>;

  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = parseMessage(event.data);
      if (message) this.messages.push(message);
    });
    this.closed = new Promise((resolve) => {
      ws.addEventListener("close", () => {
        resolve();
      });
    });
  }

  send(message: Message | string): void {
    this.ws.send(typeof message === "string" ? message : JSON.stringify(message));
  }

  async expectToReceive(message: Message): Promise<void> {
    await vi.waitFor(() => {
      expect(this.messages).toContainEqual(message);
    });
  }

  async expectLatest(message: Message): Promise<void> {
    await vi.waitFor(() => {
      expect(this.messages.at(-1)).toEqual(message);
    });
  }

  async expectNotToReceive(type: Message["type"]): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(this.messages.map((m) => m.type)).not.toContain(type);
  }
}

let room: DurableObjectStub<Room>;
const open: WebSocket[] = [];

beforeEach(() => {
  room = env.ROOM.getByName(crypto.randomUUID()); // a fresh room per test
});

afterEach(() => {
  for (const ws of open.splice(0)) ws.close();
});

function upgrade(query: string): Promise<Response> {
  return room.fetch(`http://room/?${query}`, { headers: { Upgrade: "websocket" } });
}

/** Callers in the test directory's "room" group (vitest.config.ts), handed out in turn per test. */
let nextCaller = 0;
beforeEach(() => {
  nextCaller = 0;
});

/**
 * Connects to the "room" group as the receiver (tablet@) or a caller (the next
 * member unless given), from a page (a fresh one unless given).
 */
async function join(
  role: "receiver" | "caller",
  email?: string,
  page: string = crypto.randomUUID(),
): Promise<Client> {
  nextCaller += role === "caller" && !email ? 1 : 0;
  const who =
    email ?? (role === "receiver" ? "tablet@x.com" : `caller-${String(nextCaller)}@x.com`);
  const name = who.split("@")[0] ?? "";
  const { webSocket } = await upgrade(
    `group=room&role=${role}&email=${who}&name=${name}&page=${page}`,
  );
  if (!webSocket) throw new Error("No WebSocket");
  webSocket.accept();
  open.push(webSocket);
  return new Client(webSocket);
}

/** Makes a timer run out now, as if its time had passed. */
async function runOut(name: TimerName): Promise<void> {
  await runInDurableObject(room, (_, state) => {
    const timers = state.storage.kv.get<Record<string, number>>("timers") ?? {};
    expect(timers[name]).toBeDefined();
    state.storage.kv.put("timers", { ...timers, [name]: 0 });
  });
  expect(await runDurableObjectAlarm(room)).toBe(true);
}

const timers = () =>
  runInDurableObject(room, (_, state) => state.storage.kv.get<Record<string, number>>("timers"));
const status = (s: string): Message => ({ type: "status", status: s }) as Message;
const inCallWith = (caller: string): Message => ({ type: "status", status: "in-call", caller });
const offer: Message = { type: "offer", sdp: "OFFER" };
const answer: Message = { type: "answer", sdp: "ANSWER" };

/** A receiver plus a caller (alice@) who has joined the call. */
async function inCall(): Promise<{ receiver: Client; caller: Client }> {
  const receiver = await join("receiver");
  const caller = await join("caller", "alice@x.com", "alice-page");
  await caller.expectToReceive(status("available"));
  caller.send({ type: "join" });
  await caller.expectToReceive({ type: "joined" });
  return { receiver, caller };
}

describe("room", () => {
  it("welcomes a caller and tells them the receiver is unavailable", async () => {
    const caller = await join("caller");

    await vi.waitFor(() => {
      expect(caller.messages).toEqual([
        { type: "welcome", resumed: false, version: "test-version" },
        status("unavailable"),
      ]);
    });
  });

  it("tells callers when the receiver arrives", async () => {
    const caller = await join("caller");

    const receiver = await join("receiver");

    await caller.expectLatest(status("available"));
    await receiver.expectToReceive({ type: "welcome", resumed: false, version: "test-version" });
  });

  it("puts a joining caller in the call and tells everyone it's in use", async () => {
    const watcher = await join("caller");
    await inCall();

    await watcher.expectToReceive(inCallWith("alice"));
  });

  it("tells the receiver who's calling", async () => {
    const { receiver } = await inCall();

    await vi.waitFor(() => {
      expect(receiver.messages).toContainEqual(
        expect.objectContaining({ type: "incoming", name: "alice" }),
      );
    });
  });

  it("relays signals between the receiver and the caller in the call", async () => {
    const { receiver, caller } = await inCall();

    caller.send(offer);
    await receiver.expectToReceive(offer);
    receiver.send(answer);
    await caller.expectToReceive(answer);
  });

  it("doesn't relay signals to or from callers who aren't in the call", async () => {
    const { receiver } = await inCall();
    const other = await join("caller");

    other.send(offer);
    receiver.send(answer);

    await receiver.expectNotToReceive("offer");
    await other.expectNotToReceive("answer");
  });

  it("refuses a join while someone else is in the call", async () => {
    await inCall();
    const other = await join("caller");

    other.send({ type: "join" });

    await other.expectToReceive({ type: "refused" });
    expect(other.messages).not.toContainEqual({ type: "joined" });
  });

  it("lets only one of two simultaneous joins through", async () => {
    await join("receiver");
    const alice = await join("caller");
    const bob = await join("caller");
    await bob.expectToReceive(status("available"));

    alice.send({ type: "join" });
    bob.send({ type: "join" });

    await vi.waitFor(() => {
      const outcomes = [alice, bob].map(
        (c) => c.messages.find((m) => m.type === "joined" || m.type === "refused")?.type,
      );
      expect(outcomes.sort()).toEqual(["joined", "refused"]);
    });
  });

  it("a hang-up ends the call and sends the receiver back to idle", async () => {
    const { receiver, caller } = await inCall();

    caller.send({ type: "hangup" });

    await receiver.expectToReceive({ type: "hangup" });
    await receiver.closed;
    await caller.expectLatest(status("unavailable"));
  });

  it("ignores messages that aren't valid", async () => {
    const { receiver, caller } = await inCall();

    caller.send("not json");
    caller.send(offer);

    await receiver.expectToReceive(offer);
  });

  describe("a dropped connection", () => {
    it("holds the caller's place: they can reconnect and carry on the call", async () => {
      const { receiver, caller } = await inCall();

      caller.ws.close();
      await vi.waitFor(async () => {
        expect((await timers())?.["caller-away"]).toBeDefined();
      });
      const back = await join("caller", "alice@x.com", "alice-page");

      await back.expectToReceive({ type: "welcome", resumed: true, version: "test-version" });
      back.send(offer);
      await receiver.expectToReceive(offer);
      expect(receiver.messages).not.toContainEqual({ type: "hangup" });
      expect((await timers())?.["caller-away"]).toBeUndefined();
    });

    it("lets the caller rejoin from a new page (e.g. the app reopened)", async () => {
      const { receiver, caller } = await inCall();
      caller.ws.close();
      await vi.waitFor(async () => {
        expect((await timers())?.["caller-away"]).toBeDefined();
      });

      const reopened = await join("caller", "alice@x.com", "new-page");
      await reopened.expectToReceive({ type: "welcome", resumed: false, version: "test-version" });
      await reopened.expectToReceive({
        type: "status",
        status: "in-call",
        caller: "alice",
        rejoin: true,
      });
      reopened.send({ type: "join" });

      await reopened.expectToReceive({ type: "joined" });
      await vi.waitFor(() => {
        expect(receiver.messages.filter((m) => m.type === "incoming")).toHaveLength(2);
      });
      reopened.send(offer);
      await receiver.expectToReceive(offer);
      expect((await timers())?.["caller-away"]).toBeUndefined();
    });

    it("ends the call if the caller doesn't come back in time", async () => {
      const { receiver, caller } = await inCall();
      caller.ws.close();
      await vi.waitFor(async () => {
        expect((await timers())?.["caller-away"]).toBeDefined();
      });

      await runOut("caller-away");

      await receiver.expectToReceive({ type: "hangup" });
      await receiver.closed;
    });

    it("holds the receiver's place: they can reconnect, and callers never see a blip", async () => {
      const { receiver, caller } = await inCall();

      receiver.ws.close();
      await vi.waitFor(async () => {
        expect((await timers())?.["receiver-away"]).toBeDefined();
      });
      const back = await join("receiver");

      await back.expectToReceive({ type: "welcome", resumed: true, version: "test-version" });
      caller.send(offer);
      await back.expectToReceive(offer);
      expect(caller.messages).not.toContainEqual({ type: "hangup" });
      expect(caller.messages).not.toContainEqual(status("unavailable"));
    });

    it("makes the receiver unavailable if they don't come back in time", async () => {
      const caller = await join("caller");
      const receiver = await join("receiver");
      await caller.expectLatest(status("available"));
      receiver.ws.close();
      await vi.waitFor(async () => {
        expect((await timers())?.["receiver-away"]).toBeDefined();
      });

      await runOut("receiver-away");

      await caller.expectLatest(status("unavailable"));
    });
  });

  describe("membership", () => {
    /** Changes the directory the room reads, as uploading a new one would. */
    async function removeFromGroup(email: string): Promise<void> {
      const directory = JSON.parse(env.DIRECTORY ?? "{}") as {
        groups: Record<string, { members: Record<string, unknown> }>;
      };
      delete directory.groups.room?.members[email];
      await runInDurableObject(room, (instance) => {
        const target = instance as unknown as { env: Env };
        target.env = { ...target.env, DIRECTORY: JSON.stringify(directory) };
      });
    }

    const closeCode = (client: Client) =>
      new Promise<number>((resolve) => {
        client.ws.addEventListener("close", (event) => {
          resolve(event.code);
        });
      });

    it("turns away someone who isn't in the group", async () => {
      const stranger = await join("caller", "stranger@x.com");

      expect(await closeCode(stranger)).toBe(4000);
      expect(stranger.messages.map((m) => m.type)).not.toContain("welcome");
    });

    it("turns away a member connecting in a role that isn't theirs", async () => {
      const impostor = await join("receiver", "alice@x.com");

      expect(await closeCode(impostor)).toBe(4000);
    });

    it("cuts off someone removed mid-call, ending the call at once", async () => {
      const { receiver, caller } = await inCall();
      const callerClosed = closeCode(caller);
      await removeFromGroup("alice@x.com");

      caller.send(offer); // their next message: no longer theirs to send

      expect(await callerClosed).toBe(4000);
      await receiver.expectToReceive({ type: "hangup" }); // no grace period
      await receiver.closed;
      expect(receiver.messages).not.toContainEqual(offer);
    });

    it("disconnects a removed member on the next thing that happens in the room", async () => {
      const watcher = await join("caller", "alice@x.com");
      await watcher.expectToReceive(status("unavailable"));
      const watcherClosed = closeCode(watcher);
      await removeFromGroup("alice@x.com");

      await join("caller"); // someone else connecting

      expect(await watcherClosed).toBe(4000);
    });
  });

  describe("after the room restarts (e.g. a deploy drops every socket)", () => {
    /** A call in progress whose sockets are all gone, as a restarted room finds it. */
    async function restartMidCall(): Promise<void> {
      await runInDurableObject(room, (_, state) => {
        state.storage.kv.put("state", {
          receiver: { email: "tablet@x.com", name: "tablet", connection: "gone-r" },
          callers: [{ id: "gone-a", email: "alice@x.com" }],
          active: {
            email: "alice@x.com",
            name: "alice",
            connection: "gone-a",
            page: "alice-page",
            call: "gone-a",
          },
        });
      });
    }

    it("holds the call: both sides reconnect and carry on", async () => {
      await restartMidCall();

      const caller = await join("caller", "alice@x.com", "alice-page");
      const receiver = await join("receiver");

      await caller.expectToReceive({ type: "welcome", resumed: true, version: "test-version" });
      await receiver.expectToReceive({ type: "welcome", resumed: true, version: "test-version" });
      caller.send(offer);
      await receiver.expectToReceive(offer);
    });

    it("starts their grace periods, so the call ends if they don't come back", async () => {
      await restartMidCall();

      await join("caller"); // someone else connecting makes the room look at its state

      const running = await timers();
      expect(running?.["caller-away"]).toBeDefined();
      expect(running?.["receiver-away"]).toBeDefined();
    });
  });

  describe("ready window", () => {
    const alarm = () => runInDurableObject(room, (_, state) => state.storage.getAlarm());

    it("starts when the receiver joins", async () => {
      const before = Date.now();
      await join("receiver");

      expect(await alarm()).toBeGreaterThanOrEqual(before + readyWindowMs(env));
    });

    it("sends the receiver away if nobody calls, and callers see it's unavailable", async () => {
      const caller = await join("caller");
      const receiver = await join("receiver");
      await caller.expectLatest(status("available"));

      await runOut("ready");

      await receiver.expectToReceive({ type: "timeout" });
      await receiver.closed;
      await caller.expectLatest(status("unavailable"));
    });

    it("stops once a call starts", async () => {
      await inCall();

      expect(await alarm()).toBeNull();
    });
  });

  it.each([
    "group=room&role=intruder&email=a@x.com&name=A",
    "group=room&role=caller&name=A",
    "group=room&role=caller&email=a@x.com",
    "role=caller&email=a@x.com&name=A",
  ])("rejects %s", async (query) => {
    expect((await upgrade(query)).status).toBe(400);
  });

  it("rejects requests that aren't WebSocket upgrades", async () => {
    expect((await room.fetch("http://room/?role=caller&email=a@x.com")).status).toBe(426);
  });
});

describe("timer lengths", () => {
  it.each([
    ["30", 30 * 60_000],
    ["0.5", 30_000],
    [undefined, 30 * 60_000],
    ["nonsense", 30 * 60_000],
    ["0", 30 * 60_000],
    ["-5", 30 * 60_000],
  ])("READY_WINDOW_MINUTES=%s is %i ms", (minutes, expected) => {
    expect(readyWindowMs(minutes === undefined ? {} : { READY_WINDOW_MINUTES: minutes })).toBe(
      expected,
    );
  });

  it.each([
    ["30", 30_000],
    ["2.5", 2500],
    [undefined, 30_000],
    ["nonsense", 30_000],
  ])("GRACE_SECONDS=%s is %i ms", (seconds, expected) => {
    expect(graceMs(seconds === undefined ? {} : { GRACE_SECONDS: seconds })).toBe(expected);
  });

  it("uses the ready window for the ready timer and the grace period for the rest", () => {
    const config = { READY_WINDOW_MINUTES: "1", GRACE_SECONDS: "2" };

    expect(timerMs("ready", config)).toBe(60_000);
    expect(timerMs("receiver-away", config)).toBe(2000);
    expect(timerMs("caller-away", config)).toBe(2000);
  });
});
