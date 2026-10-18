import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReceiverEvent } from "./receiver-session";
import { mountReceiver } from "./receiver-view";

let root: HTMLElement;
let emit: ((event: ReceiverEvent) => void) | undefined;

beforeEach(() => {
  root = document.createElement("main");
  emit = undefined;
  mountReceiver(root, (onEvent) => {
    emit = onEvent;
    return { leave: vi.fn() };
  });
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
