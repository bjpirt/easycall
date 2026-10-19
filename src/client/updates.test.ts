import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkEveryMs, reloadAfterIdleMs, watchForUpdates, type UpdateDeps } from "./updates";

class FakePage extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";

  show(): void {
    this.visibilityState = "visible";
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

let page: FakePage;
let deps: UpdateDeps & {
  fetchVersion: ReturnType<typeof vi.fn<UpdateDeps["fetchVersion"]>>;
  reload: ReturnType<typeof vi.fn<() => void>>;
};

beforeEach(() => {
  vi.useFakeTimers();
  page = new FakePage();
  deps = {
    fetchVersion: vi.fn(() => Promise.resolve("v1")),
    reload: vi.fn<() => void>(),
    page,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

const watch = () => watchForUpdates(deps, "v1");

describe("watchForUpdates", () => {
  it("does nothing while the version is current", () => {
    const updates = watch();

    updates.noteVersion("v1");
    vi.advanceTimersByTime(reloadAfterIdleMs * 10);

    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("reloads an idle page a minute after hearing of a new version", () => {
    const updates = watch();

    updates.noteVersion("v2");
    vi.advanceTimersByTime(reloadAfterIdleMs - 1);
    expect(deps.reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads while the page is in use, but does once it's idle again", () => {
    const updates = watch();
    updates.busy();

    updates.noteVersion("v2");
    vi.advanceTimersByTime(reloadAfterIdleMs * 10);
    expect(deps.reload).not.toHaveBeenCalled();

    updates.idle();
    vi.advanceTimersByTime(reloadAfterIdleMs);

    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("cancels a pending reload if the page comes into use", () => {
    const updates = watch();
    updates.noteVersion("v2");
    vi.advanceTimersByTime(reloadAfterIdleMs - 1);

    updates.busy();
    vi.advanceTimersByTime(reloadAfterIdleMs);

    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("checks for a new version every so often", async () => {
    watch();
    deps.fetchVersion.mockResolvedValue("v2");

    await vi.advanceTimersByTimeAsync(checkEveryMs);
    await vi.advanceTimersByTimeAsync(reloadAfterIdleMs);

    expect(deps.fetchVersion).toHaveBeenCalledTimes(1);
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("checks when the page becomes visible", async () => {
    watch();
    deps.fetchVersion.mockResolvedValue("v2");

    page.show();
    await vi.advanceTimersByTimeAsync(reloadAfterIdleMs);

    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("carries on if the check fails (e.g. offline)", async () => {
    watch();
    deps.fetchVersion.mockResolvedValue(undefined);

    await vi.advanceTimersByTimeAsync(checkEveryMs + reloadAfterIdleMs);

    expect(deps.reload).not.toHaveBeenCalled();
  });
});
