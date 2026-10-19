import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRoom, retryDelays, type RoomHandlers } from "./room-connection";
import { FakeSocket } from "./test-fakes";

let sockets: FakeSocket[];
let handlers: { [K in keyof RoomHandlers]: ReturnType<typeof vi.fn<RoomHandlers[K]>> };

beforeEach(() => {
  vi.useFakeTimers();
  sockets = [];
  handlers = { onMessage: vi.fn(), onReconnecting: vi.fn(), onClosed: vi.fn() };
});

afterEach(() => {
  vi.useRealTimers();
});

const connect = () => {
  const socket = new FakeSocket();
  sockets.push(socket);
  return socket;
};
const latest = (): FakeSocket => {
  const socket = sockets.at(-1);
  if (!socket) throw new Error("Not connected yet");
  return socket;
};
const drop = (code = 1006) => {
  latest().dispatchEvent(new CloseEvent("close", { code }));
};

describe("openRoom", () => {
  it("passes on the room's messages", () => {
    openRoom(connect, handlers);

    latest().receive({ type: "welcome", resumed: false, version: "test-version" });

    expect(handlers.onMessage).toHaveBeenCalledWith({
      type: "welcome",
      resumed: false,
      version: "test-version",
    });
  });

  it("sends messages to the room", () => {
    const room = openRoom(connect, handlers);

    room.send({ type: "join" });

    expect(latest().sent()).toEqual([{ type: "join" }]);
  });

  it("reconnects after a drop, waiting longer each time", () => {
    openRoom(connect, handlers);

    for (const delay of retryDelays) {
      drop();
      expect(handlers.onReconnecting).toHaveBeenCalled();
      const before = sockets.length;
      vi.advanceTimersByTime(delay - 1);
      expect(sockets).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(sockets).toHaveLength(before + 1);
    }
    // ... and keeps trying at the longest delay.
    drop();
    vi.advanceTimersByTime(retryDelays.at(-1) ?? 0);
    expect(sockets).toHaveLength(retryDelays.length + 2);
  });

  it("goes back to the shortest delay once reconnected", () => {
    openRoom(connect, handlers);
    drop();
    vi.advanceTimersByTime(retryDelays[0] ?? 0);
    drop();
    vi.advanceTimersByTime(retryDelays[1] ?? 0);

    latest().receive({ type: "welcome", resumed: true, version: "test-version" });
    drop();
    vi.advanceTimersByTime(retryDelays[0] ?? 0);

    expect(sockets).toHaveLength(4);
  });

  it("doesn't retry when the room closes the connection on purpose", () => {
    openRoom(connect, handlers);

    drop(4000);
    vi.advanceTimersByTime(60_000);

    expect(handlers.onClosed).toHaveBeenCalled();
    expect(handlers.onReconnecting).not.toHaveBeenCalled();
    expect(sockets).toHaveLength(1);
  });

  it("close() stops for good, including a pending retry", () => {
    const room = openRoom(connect, handlers);
    drop();

    room.close();
    vi.advanceTimersByTime(60_000);

    expect(sockets).toHaveLength(1);
    expect(latest().close).toHaveBeenCalled();
  });

  it("drops messages quietly while not connected", () => {
    const room = openRoom(connect, handlers);
    latest().send.mockImplementation(() => {
      throw new DOMException("Still connecting", "InvalidStateError");
    });

    expect(() => {
      room.send({ type: "join" });
    }).not.toThrow();
  });
});
