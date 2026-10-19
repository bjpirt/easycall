import type { Page } from "./dom";

/** Releases a wake lock taken by `keepAwake`. */
export type Release = () => void;

/**
 * Keeps the screen on until released (Screen Wake Lock API). Browsers drop the
 * lock whenever the page is hidden (another app, the screen briefly off), so
 * it's taken again when the page is visible. It's a nice-to-have: where it's
 * unsupported or refused (e.g. battery saver), the app carries on without it.
 */
export function keepAwake(
  wakeLock: WakeLock | undefined = "wakeLock" in navigator ? navigator.wakeLock : undefined,
  page: Page = document,
): Release {
  if (!wakeLock) return () => undefined;

  let held = true;
  let lock: WakeLockSentinel | undefined;

  const take = async (): Promise<void> => {
    if (page.visibilityState !== "visible" || (lock && !lock.released)) return;
    try {
      const taken = await wakeLock.request("screen");
      if (held) lock = taken;
      else await taken.release(); // released while we were waiting for it
    } catch {
      // Not now (e.g. battery saver); we'll try again when the page is next visible.
    }
  };
  const onVisibilityChange = (): void => {
    void take();
  };

  page.addEventListener("visibilitychange", onVisibilityChange);
  void take();

  return () => {
    held = false;
    page.removeEventListener("visibilitychange", onVisibilityChange);
    lock?.release().catch(() => undefined);
    lock = undefined;
  };
}
