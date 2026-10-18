import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseMessage, type Message } from "../shared/protocol";

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

let room: DurableObjectStub;
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

  it("ignores a join while the receiver is busy", async () => {
    await inCall();
    const other = await join("caller");

    other.send({ type: "join" });

    await other.expectNotToReceive("joined");
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

  it("rejects an unknown role", async () => {
    expect((await upgrade("intruder")).status).toBe(400);
  });

  it("rejects requests that aren't WebSocket upgrades", async () => {
    expect((await room.fetch("http://room/?role=caller")).status).toBe(426);
  });
});
