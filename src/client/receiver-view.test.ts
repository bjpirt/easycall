import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceiverEvent } from "./receiver-session";
import { mountReceiver } from "./receiver-view";

let root: HTMLElement;
const awake = { take: vi.fn(), release: vi.fn() };
let emit: ((event: ReceiverEvent) => void) | undefined;

beforeEach(() => {
  root = document.createElement("main");
  emit = undefined;
  awake.take.mockClear().mockReturnValue(awake.release);
  awake.release.mockClear();
  mountReceiver(
    root,
    (onEvent) => {
      emit = onEvent;
      return { leave: vi.fn() };
    },
    awake.take,
  );
});

function join(): (event: ReceiverEvent) => void {
  root.querySelector("button")?.click();
  if (!emit) throw new Error("Session not started");
  return emit;
}

const videos = () => [...root.querySelectorAll("video")].map((v) => [v.className, v.srcObject]);

describe("receiver view", () => {
  it("starts idle with a Join call button", () => {
    expect(root.querySelector("button")?.textContent).toBe("Join call");
    expect(emit).toBeUndefined();
  });

  it("shows waiting with a self-view once joined", () => {
    const camera = new MediaStream();

    join()({ type: "waiting", camera });

    expect(root.textContent).toContain("Waiting for a call…");
    expect(videos()).toEqual([["self-view", camera]]);
  });

  it("shows the caller full screen, with nothing to tap", () => {
    const camera = new MediaStream();
    const remote = new MediaStream();

    join()({ type: "remote", camera, remote });

    expect(videos()).toEqual([
      ["remote-view", remote],
      ["self-view", camera],
    ]);
    expect(root.querySelector<HTMLVideoElement>(".self-view")?.muted).toBe(true);
    expect(root.querySelector<HTMLVideoElement>(".remote-view")?.muted).toBe(false);
    expect(root.querySelectorAll("button")).toHaveLength(0);
  });

  it("returns to idle with the reason when the session ends", () => {
    join()({ type: "ended", reason: "Lost connection." });

    expect(root.querySelector("button")?.textContent).toBe("Join call");
    expect(root.textContent).toContain("Lost connection.");
  });
});

describe("call notices", () => {
  const notice = () => root.querySelector<HTMLElement>(".notice");

  it("shows Connecting… until media flows, and Reconnecting… if it's interrupted", () => {
    const send = join();
    send({ type: "remote", camera: new MediaStream(), remote: new MediaStream() });
    expect(notice()?.textContent).toBe("Connecting…");

    send({ type: "media", state: "connected" });
    expect(notice()?.hidden).toBe(true);

    send({ type: "media", state: "interrupted" });
    expect(notice()?.textContent).toBe("Reconnecting…");

    send({ type: "media", state: "connected" });
    send({ type: "connection", state: "reconnecting" });
    expect(notice()?.textContent).toBe("Reconnecting…");
  });

  it("has no notice while waiting", () => {
    join()({ type: "waiting", camera: new MediaStream() });

    expect(notice()).toBeNull();
  });
});

describe("keeping the screen awake", () => {
  it("doesn't while idle", () => {
    expect(awake.take).not.toHaveBeenCalled();
  });

  it("does while waiting and during the call, then lets it sleep once back to idle", () => {
    const send = join();
    send({ type: "waiting", camera: new MediaStream() });
    send({ type: "remote", camera: new MediaStream(), remote: new MediaStream() });
    expect(awake.take).toHaveBeenCalledTimes(1);
    expect(awake.release).not.toHaveBeenCalled();

    send({ type: "ended", reason: "The call has ended." });

    expect(awake.release).toHaveBeenCalledTimes(1);
  });
});
