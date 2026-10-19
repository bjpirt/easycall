import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "./dom";
import { keepAwake, whileInUse } from "./wake-lock";

class FakeLock {
  released = false;
  release = vi.fn(() => {
    this.released = true;
    return Promise.resolve();
  });
}

class FakePage extends EventTarget implements Page {
  visibilityState: DocumentVisibilityState = "visible";

  override addEventListener(type: "visibilitychange", listener: () => void): void {
    super.addEventListener(type, listener);
  }

  override removeEventListener(type: "visibilitychange", listener: () => void): void {
    super.removeEventListener(type, listener);
  }

  show(): void {
    this.visibilityState = "visible";
    this.dispatchEvent(new Event("visibilitychange"));
  }

  hide(locks: FakeLock[]): void {
    this.visibilityState = "hidden";
    for (const lock of locks) lock.released = true; // the browser drops the lock
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

let locks: FakeLock[];
let wakeLock: WakeLock;
let request: ReturnType<typeof vi.fn>;
let page: FakePage;

beforeEach(() => {
  locks = [];
  request = vi.fn(() => {
    const lock = new FakeLock();
    locks.push(lock);
    return Promise.resolve(lock);
  });
  wakeLock = { request } as unknown as WakeLock;
  page = new FakePage();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("keepAwake", () => {
  it("takes a screen wake lock", async () => {
    keepAwake(wakeLock, page);
    await settle();

    expect(request).toHaveBeenCalledWith("screen");
  });

  it("releases it when released", async () => {
    const release = keepAwake(wakeLock, page);
    await settle();

    release();

    expect(locks[0]?.release).toHaveBeenCalled();
  });

  it("takes it again when the page is visible again after being hidden", async () => {
    keepAwake(wakeLock, page);
    await settle();

    page.hide(locks);
    page.show();
    await settle();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("doesn't take a second lock while it already has one", async () => {
    keepAwake(wakeLock, page);
    await settle();

    page.show();
    await settle();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("waits until the page is visible", async () => {
    page.visibilityState = "hidden";
    keepAwake(wakeLock, page);
    await settle();
    expect(request).not.toHaveBeenCalled();

    page.show();
    await settle();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("stops taking it once released", async () => {
    const release = keepAwake(wakeLock, page);
    await settle();
    release();

    page.hide(locks);
    page.show();
    await settle();

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("releases a lock that arrives after it was released", async () => {
    const release = keepAwake(wakeLock, page);

    release();
    await settle();

    expect(locks[0]?.release).toHaveBeenCalled();
  });

  it("carries on if the lock is refused, trying again later", async () => {
    request.mockRejectedValueOnce(new DOMException("Battery saver", "NotAllowedError"));
    keepAwake(wakeLock, page);
    await settle();

    page.show();
    await settle();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does nothing where the API isn't available", () => {
    const release = keepAwake(undefined, page);

    expect(() => {
      release();
    }).not.toThrow();
  });
});

describe("whileInUse", () => {
  it("takes once while in use, and releases when it's not", () => {
    const release = vi.fn();
    const take = vi.fn(() => release);
    const set = whileInUse(take);

    set(true);
    set(true);
    expect(take).toHaveBeenCalledTimes(1);

    set(false);
    set(false);
    expect(release).toHaveBeenCalledTimes(1);

    set(true);
    expect(take).toHaveBeenCalledTimes(2);
  });
});
