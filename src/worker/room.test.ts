import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it } from "vitest";

const open: WebSocket[] = [];

afterEach(() => {
  for (const ws of open.splice(0)) ws.close();
});

async function connect(role: string): Promise<WebSocket> {
  const response = await exports.default.fetch(`http://example.com/api/room?role=${role}`, {
    headers: { Upgrade: "websocket" },
  });
  const ws = response.webSocket;
  if (!ws) throw new Error(`No WebSocket (status ${String(response.status)})`);
  ws.accept();
  open.push(ws);
  return ws;
}

/** Resolves with the next message, or `undefined` if none arrives within `ms`. */
function nextMessage(ws: WebSocket, ms = 200): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(undefined);
    }, ms);
    ws.addEventListener(
      "message",
      (event) => {
        clearTimeout(timer);
        resolve(event.data);
      },
      { once: true },
    );
  });
}

describe("room relay", () => {
  it("relays receiver messages to the caller", async () => {
    const receiver = await connect("receiver");
    const caller = await connect("caller");

    const received = nextMessage(caller);
    receiver.send("hello caller");

    expect(await received).toBe("hello caller");
  });

  it("relays caller messages to the receiver", async () => {
    const receiver = await connect("receiver");
    const caller = await connect("caller");

    const received = nextMessage(receiver);
    caller.send("hello receiver");

    expect(await received).toBe("hello receiver");
  });

  it("doesn't echo messages back to the sender", async () => {
    const receiver = await connect("receiver");
    await connect("caller");

    const echoed = nextMessage(receiver);
    receiver.send("ping");

    expect(await echoed).toBeUndefined();
  });

  it("doesn't relay messages between callers", async () => {
    await connect("receiver");
    const caller = await connect("caller");
    const otherCaller = await connect("caller");

    const overheard = nextMessage(otherCaller);
    caller.send("private");

    expect(await overheard).toBeUndefined();
  });

  it("rejects an unknown role", async () => {
    const response = await exports.default.fetch("http://example.com/api/room?role=intruder", {
      headers: { Upgrade: "websocket" },
    });

    expect(response.status).toBe(400);
  });

  it("rejects requests that aren't WebSocket upgrades", async () => {
    const response = await exports.default.fetch("http://example.com/api/room?role=caller");

    expect(response.status).toBe(426);
  });
});
