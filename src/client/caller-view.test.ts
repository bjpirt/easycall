import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Status } from "../shared/protocol";
import type { CallerEvent } from "./caller-session";
import { mountCaller } from "./caller-view";

let root: HTMLElement;
let emit: (event: CallerEvent) => void;
const session = { join: vi.fn(), hangUp: vi.fn() };

beforeEach(() => {
  root = document.createElement("main");
  session.join.mockClear();
  session.hangUp.mockClear();
  mountCaller(root, (onEvent) => {
    emit = onEvent;
    return session;
  });
});

const button = (name: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === name);
const videos = () => [...root.querySelectorAll("video")].map((v) => [v.className, v.srcObject]);

describe("caller view", () => {
  it("shows that it's connecting, with Join call disabled", () => {
    expect(root.textContent).toContain("Connecting…");
    expect(button("Join call")?.disabled).toBe(true);
  });

  it.each([
    ["unavailable", "Not available right now", true],
    ["available", "Ready for a call", false],
    ["in-call", "In a call", true],
  ] as [Status, string, boolean][])(
    "when %s shows '%s' (Join call disabled: %s)",
    (status, text, disabled) => {
      emit({ type: "status", status });

      expect(root.textContent).toContain(text);
      expect(button("Join call")?.disabled).toBe(disabled);
    },
  );

  it("Join call starts joining", () => {
    emit({ type: "status", status: "available" });

    button("Join call")?.click();

    expect(session.join).toHaveBeenCalled();
    expect(root.textContent).toContain("Starting…");
  });

  it("shows calling with a self-view and Hang up", () => {
    const camera = new MediaStream();

    emit({ type: "calling", camera });
    button("Hang up")?.click();

    expect(root.textContent).toContain("Calling…");
    expect(videos()).toEqual([["self-view", camera]]);
    expect(session.hangUp).toHaveBeenCalled();
  });

  it("shows the receiver full screen with a self-view and Hang up", () => {
    const camera = new MediaStream();
    const remote = new MediaStream();

    emit({ type: "remote", camera, remote });

    expect(videos()).toEqual([
      ["remote-view", remote],
      ["self-view", camera],
    ]);
    expect(button("Hang up")).toBeDefined();
  });

  it("doesn't interrupt a call when the status changes", () => {
    const camera = new MediaStream();
    emit({ type: "calling", camera });

    emit({ type: "status", status: "in-call" });

    expect(root.textContent).toContain("Calling…");
  });

  it("returns quietly to idle with the latest status after hanging up", () => {
    emit({ type: "calling", camera: new MediaStream() });
    emit({ type: "status", status: "unavailable" });

    emit({ type: "call-ended" });

    expect(root.textContent).toBe("Not available right now" + "Join call");
    expect(button("Join call")?.disabled).toBe(true);
  });

  it("shows why a call ended", () => {
    emit({ type: "call-ended", reason: "The call has ended." });

    expect(root.textContent).toContain("The call has ended.");
  });

  it("shows a lost connection with Join call disabled", () => {
    emit({ type: "status", status: "available" });

    emit({ type: "disconnected" });

    expect(root.textContent).toContain("Lost connection");
    expect(button("Join call")?.disabled).toBe(true);
  });
});
