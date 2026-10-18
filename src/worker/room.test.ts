import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMessage, type Message } from "../shared/protocol";
import { readyWindowMs, type Room } from "./room";

/** A test WebSocket client that records every valid message it receives. */
class Client {
  readonly messages: Message[] = [];

  constructor(readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      const message = parseMessage(event.data);
      if (message) this.messages.push(message);
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

function upgrade(role: string): Promise<Response> {
  return room.fetch(`http://room/?role=${role}`, { headers: { Upgrade: "websocket" } });
}

async function join(role: "receiver" | "caller"): Promise<Client> {
  const { webSocket } = await upgrade(role);
  if (!webSocket) throw new Error("No WebSocket");
  webSocket.accept();
  open.push(webSocket);
  return new Client(webSocket);
}

const status = (s: string): Message => ({ type: "status", status: s }) as Message;
const offer: Message = { type: "offer", sdp: "OFFER" };
const answer: Message = { type: "answer", sdp: "ANSWER" };

/** A receiver plus a caller who has joined the call. */
async function inCall(): Promise<{ receiver: Client; caller: Client }> {
  const receiver = await join("receiver");
  const caller = await join("caller");
  await caller.expectToReceive(status("available"));
  caller.send({ type: "join" });
  await caller.expectToReceive({ type: "joined" });
  return { receiver, caller };
}

describe("room", () => {
  it("tells a caller the receiver is unavailable", async () => {
    const caller = await join("caller");

    await caller.expectToReceive(status("unavailable"));
  });

  it("tells callers when the receiver arrives and leaves", async () => {
    const caller = await join("caller");
    const receiver = await join("receiver");
    await caller.expectToReceive(status("available"));

    receiver.ws.close();

    await vi.waitFor(() => {
      expect(caller.messages.at(-1)).toEqual(status("unavailable"));
    });
  });

  it("puts a joining caller in the call and tells everyone it's in use", async () => {
    const watcher = await join("caller");
    await inCall();

    await watcher.expectToReceive(status("in-call"));
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

  it("a hang-up ends the call, tells the receiver and frees the room", async () => {
    const { receiver, caller } = await inCall();

    caller.send({ type: "hangup" });

    await receiver.expectToReceive({ type: "hangup" });
    await vi.waitFor(() => {
      expect(caller.messages.at(-1)).toEqual(status("available"));
    });
  });

  it("ends the call if the caller's connection drops", async () => {
    const { receiver, caller } = await inCall();

    caller.ws.close();

    await receiver.expectToReceive({ type: "hangup" });
  });

  it("ignores messages that aren't valid", async () => {
    const { receiver, caller } = await inCall();

    caller.send("not json");
    caller.send(offer);

    await receiver.expectToReceive(offer);
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
      await caller.expectToReceive(status("available"));
      const closed = new Promise((resolve) => {
        receiver.ws.addEventListener("close", resolve);
      });

      expect(await runDurableObjectAlarm(room)).toBe(true);

      await receiver.expectToReceive({ type: "timeout" });
      await closed;
      await vi.waitFor(() => {
        expect(caller.messages.at(-1)).toEqual(status("unavailable"));
      });
    });

    it("is paused during a call and restarts afterwards", async () => {
      const { caller } = await inCall();
      expect(await alarm()).toBeNull();

      caller.send({ type: "hangup" });

      await vi.waitFor(async () => {
        expect(await alarm()).not.toBeNull();
      });
    });
  });

  it("rejects an unknown role", async () => {
    expect((await upgrade("intruder")).status).toBe(400);
  });

  it("rejects requests that aren't WebSocket upgrades", async () => {
    expect((await room.fetch("http://room/?role=caller")).status).toBe(426);
  });
});

describe("readyWindowMs", () => {
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
});
