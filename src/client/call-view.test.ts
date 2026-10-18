import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../shared/roles";
import { mountCallView } from "./call-view";
import type { SessionEvent } from "./session";

let root: HTMLElement;
let emit: ((event: SessionEvent) => void) | undefined;
const hangUp = vi.fn();

beforeEach(() => {
  root = document.createElement("main");
  emit = undefined;
  hangUp.mockClear();
});

function mount(role: Role): void {
  mountCallView(root, role, (onEvent) => {
    emit = onEvent;
    return { hangUp };
  });
}

function join(): (event: SessionEvent) => void {
  button("Join call")?.click();
  if (!emit) throw new Error("Session not started");
  return emit;
}

const button = (name: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === name);
const videos = () => [...root.querySelectorAll("video")].map((v) => [v.className, v.srcObject]);

describe("call view", () => {
  it("starts idle with a Join call button and no session", () => {
    mount("receiver");

    expect(button("Join call")).toBeDefined();
    expect(emit).toBeUndefined();
  });

  it("shows a starting message after Join call", () => {
    mount("receiver");
    join();

    expect(root.textContent).toContain("Starting…");
  });

  it.each([
    ["receiver", "Waiting for a call…"],
    ["caller", "Calling…"],
  ] as const)("the %s shows '%s' with a self-view once connected", (role, text) => {
    mount(role);
    const camera = new MediaStream();

    join()({ type: "connected", camera });

    expect(root.textContent).toContain(text);
    expect(videos()).toEqual([["self-view", camera]]);
  });

  it("shows the other person full screen with the self-view in the corner", () => {
    mount("caller");
    const camera = new MediaStream();
    const remote = new MediaStream();

    join()({ type: "remote", camera, remote });

    expect(videos()).toEqual([
      ["remote-view", remote],
      ["self-view", camera],
    ]);
    expect(root.querySelector<HTMLVideoElement>(".self-view")?.muted).toBe(true);
    expect(root.querySelector<HTMLVideoElement>(".remote-view")?.muted).toBe(false);
  });

  it.each(["connected", "remote"] as const)("the caller can hang up when %s", (type) => {
    mount("caller");
    const camera = new MediaStream();

    join()({ type, camera, remote: camera });
    button("Hang up")?.click();

    expect(hangUp).toHaveBeenCalled();
  });

  it("the receiver has nothing to tap once joined", () => {
    mount("receiver");
    const camera = new MediaStream();

    join()({ type: "remote", camera, remote: camera });

    expect(root.querySelectorAll("button")).toHaveLength(0);
  });

  it("returns to idle quietly after a hang-up", () => {
    mount("caller");

    join()({ type: "ended" });

    expect(button("Join call")).toBeDefined();
    expect(root.querySelector("p")).toBeNull();
  });

  it("returns to idle with the reason when the session ends unexpectedly", () => {
    mount("receiver");

    join()({ type: "ended", reason: "Lost connection." });

    expect(button("Join call")).toBeDefined();
    expect(root.textContent).toContain("Lost connection.");
  });
});
