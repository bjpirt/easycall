import { beforeEach, describe, expect, it } from "vitest";
import type { Role } from "../shared/roles";
import { mountCallView } from "./call-view";
import type { SessionEvent } from "./session";

let root: HTMLElement;
let emit: ((event: SessionEvent) => void) | undefined;

beforeEach(() => {
  root = document.createElement("main");
  emit = undefined;
});

function mount(role: Role): void {
  mountCallView(root, role, (onEvent) => {
    emit = onEvent;
    return Promise.resolve();
  });
}

function join(): (event: SessionEvent) => void {
  root.querySelector("button")?.click();
  if (!emit) throw new Error("Session not started");
  return emit;
}

const videos = () => [...root.querySelectorAll("video")].map((v) => [v.className, v.srcObject]);

describe("call view", () => {
  it("starts idle with a Join call button and no session", () => {
    mount("receiver");

    expect(root.querySelector("button")?.textContent).toBe("Join call");
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

  it("returns to idle with the reason when the session ends", () => {
    mount("receiver");

    join()({ type: "ended", reason: "Lost connection." });

    expect(root.querySelector("button")?.textContent).toBe("Join call");
    expect(root.textContent).toContain("Lost connection.");
  });
});
