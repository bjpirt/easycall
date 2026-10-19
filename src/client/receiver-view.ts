import { callNotice, type MediaState } from "./call-status";
import { element, nameLabel, video } from "./dom";
import type { StartReceiver } from "./receiver-session";
import { keepAwake, type Release } from "./wake-lock";

type State =
  | { screen: "idle"; error?: string }
  | { screen: "joining" }
  | { screen: "waiting"; camera: MediaStream }
  | { screen: "active"; camera: MediaStream; remote: MediaStream };

/**
 * The receiver (tablet) view. Idle shows a "Join call" button for staff;
 * joining turns on the camera and waits. Calls are answered automatically and
 * there's nothing to tap once joined. A notice shows while a call is connecting
 * or reconnecting. While it's in use (from Join call until it's idle again) the
 * screen is kept awake, and Join call goes full screen (the tap is the gesture
 * browsers require).
 */
export function mountReceiver(
  root: HTMLElement,
  start: StartReceiver,
  /** Called when the view comes into use; the result is called when it's idle again. */
  inUse: () => Release = keepAwake,
  fullscreen: () => void = goFullscreen,
): void {
  let release: Release | undefined;
  let current: State = { screen: "idle" };
  let media: MediaState = "connecting";
  let roomReconnecting = false;
  /** Who's calling, once a call starts. */
  let caller: string | undefined;
  /** Updated in place, so the videos aren't rebuilt (which would make them flash). */
  const notice = element("p");
  notice.className = "notice";

  const render = (state: State): void => {
    current = state;
    root.className = `call receiver ${state.screen}`;
    root.replaceChildren(...view(state));
    updateNotice();
    setInUse(state.screen !== "idle");
  };

  const setInUse = (on: boolean): void => {
    if (on) release ??= inUse();
    else {
      release?.();
      release = undefined;
    }
  };

  const updateNotice = (): void => {
    const text = current.screen === "active" ? callNotice(media, roomReconnecting) : undefined;
    notice.textContent = text ?? "";
    notice.hidden = text === undefined;
  };

  const view = (state: State): HTMLElement[] => {
    switch (state.screen) {
      case "idle": {
        const button = element("button", "Join call");
        button.addEventListener("click", join);
        return state.error ? [button, element("p", state.error)] : [button];
      }
      case "joining":
        return [element("p", "Starting…")];
      case "waiting":
        return [
          element("p", caller ? `${caller} is calling…` : "Waiting for a call…"),
          video(state.camera, "self-view"),
        ];
      case "active":
        return [
          video(state.remote, "remote-view"),
          ...(caller ? [nameLabel(caller)] : []),
          video(state.camera, "self-view"),
          notice,
        ];
    }
  };

  const join = (): void => {
    fullscreen();
    media = "connecting";
    roomReconnecting = false;
    caller = undefined;
    render({ screen: "joining" });
    start((event) => {
      switch (event.type) {
        case "waiting":
          render({ screen: "waiting", camera: event.camera });
          return;
        case "remote":
          render({ screen: "active", camera: event.camera, remote: event.remote });
          return;
        case "incoming":
          caller = event.name;
          if (current.screen === "waiting") render(current);
          return;
        case "media":
          media = event.state;
          updateNotice();
          return;
        case "connection":
          roomReconnecting = event.state === "reconnecting";
          updateNotice();
          return;
        case "ended":
          render(event.reason ? { screen: "idle", error: event.reason } : { screen: "idle" });
          return;
      }
    });
  };

  render({ screen: "idle" });
}

/** Full screen where the browser allows it (already the case when installed). */
function goFullscreen(): void {
  if (document.fullscreenEnabled && !document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => undefined);
  }
}
