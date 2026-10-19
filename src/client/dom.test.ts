import { describe, expect, it } from "vitest";
import { blockPinchZoom, lockZoom, notice, setNotice } from "./dom";

describe("notice", () => {
  it("starts hidden, shows text, and hides again when there's nothing to say", () => {
    const el = notice();
    expect(el.hidden).toBe(true);

    setNotice(el, "Reconnecting…");
    expect([el.textContent, el.hidden]).toEqual(["Reconnecting…", false]);

    setNotice(el, undefined);
    expect([el.textContent, el.hidden]).toEqual(["", true]);
  });
});

describe("lockZoom", () => {
  it("stops the page being zoomed", () => {
    const page = document.implementation.createHTMLDocument();
    const meta = page.createElement("meta");
    meta.name = "viewport";
    meta.content = "width=device-width, initial-scale=1";
    page.head.append(meta);

    lockZoom(page);

    expect(meta.content).toContain("maximum-scale=1");
    expect(meta.content).toContain("user-scalable=no");
  });
});

describe("blockPinchZoom", () => {
  const pinch = (page: EventTarget): Event => {
    const event = new Event("gesturestart", { cancelable: true });
    page.dispatchEvent(event);
    return event;
  };

  it("cancels Safari's pinch gestures only while the screen can't be zoomed", () => {
    const page = new EventTarget();
    const root = document.createElement("main");
    blockPinchZoom(root, page);

    expect(pinch(page).defaultPrevented).toBe(false);

    root.classList.add("no-zoom");
    expect(pinch(page).defaultPrevented).toBe(true);
  });
});
