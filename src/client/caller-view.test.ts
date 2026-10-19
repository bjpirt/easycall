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
  mountCaller(root, "Grandma", (onEvent) => {
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
    ["unavailable", "Grandma isn't available right now", true],
    ["available", "Grandma is ready for a call", false],
    ["in-call", "Grandma is in a call", true],
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

    expect(root.textContent).toBe("Grandma isn't available right now" + "Join call");
    expect(button("Join call")?.disabled).toBe(true);
  });

  it("shows why a call ended", () => {
    emit({ type: "call-ended", reason: "The call has ended." });

    expect(root.textContent).toContain("The call has ended.");
  });

  it.each([
    ["reconnecting", "Reconnecting…"],
    ["closed", "Disconnected. Reload the page to try again."],
  ] as const)("when the connection is %s, says so with Join call disabled", (state, text) => {
    emit({ type: "status", status: "available" });

    emit({ type: "connection", state });

    expect(root.textContent).toContain(text);
    expect(button("Join call")?.disabled).toBe(true);
  });

  it("once reconnected, waits for the room's status", () => {
    emit({ type: "connection", state: "reconnecting" });

    emit({ type: "connection", state: "connected" });
    emit({ type: "status", status: "available" });

    expect(root.textContent).toContain("Grandma is ready for a call");
  });
});

describe("call notices", () => {
  const notice = () => root.querySelector<HTMLElement>(".notice");

  it("shows Calling…, or Reconnecting… while the room connection is down", () => {
    emit({ type: "calling", camera: new MediaStream() });
    expect(notice()?.textContent).toBe("Calling…");

    emit({ type: "connection", state: "reconnecting" });
    expect(notice()?.textContent).toBe("Reconnecting…");
  });

  it("shows Connecting… until media flows, then nothing", () => {
    emit({ type: "calling", camera: new MediaStream() });
    emit({ type: "remote", camera: new MediaStream(), remote: new MediaStream() });
    expect(notice()?.textContent).toBe("Connecting…");
    expect(notice()?.hidden).toBe(false);

    emit({ type: "media", state: "connected" });

    expect(notice()?.hidden).toBe(true);
  });

  it.each([
    ["the media is interrupted", { type: "media", state: "interrupted" }],
    ["the room connection drops", { type: "connection", state: "reconnecting" }],
  ] as [string, CallerEvent][])("shows Reconnecting… when %s", (_, event) => {
    emit({ type: "calling", camera: new MediaStream() });
    emit({ type: "remote", camera: new MediaStream(), remote: new MediaStream() });
    emit({ type: "media", state: "connected" });

    emit(event);

    expect(notice()?.textContent).toBe("Reconnecting…");
    expect(notice()?.hidden).toBe(false);
  });

  it("updates without rebuilding the videos (which would make them flash)", () => {
    emit({ type: "calling", camera: new MediaStream() });
    emit({ type: "remote", camera: new MediaStream(), remote: new MediaStream() });
    const before = [...root.querySelectorAll("video")];

    emit({ type: "media", state: "connected" });
    emit({ type: "media", state: "interrupted" });

    const after = [...root.querySelectorAll("video")];
    expect(after).toHaveLength(2);
    expect(after.every((video, i) => video === before[i])).toBe(true);
  });

  it("starts each call as Connecting…", () => {
    emit({ type: "calling", camera: new MediaStream() });
    emit({ type: "remote", camera: new MediaStream(), remote: new MediaStream() });
    emit({ type: "media", state: "connected" });
    emit({ type: "call-ended" });

    emit({ type: "calling", camera: new MediaStream() });
    emit({ type: "remote", camera: new MediaStream(), remote: new MediaStream() });

    expect(notice()?.textContent).toBe("Connecting…");
  });
});
