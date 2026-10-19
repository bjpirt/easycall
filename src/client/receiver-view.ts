import { callNotice, type MediaState } from "./call-status";
import { element, nameLabel, video } from "./dom";
import type { ReceiverEvent, ReceiverSession } from "./receiver-session";
import { keepAwake, type Release } from "./wake-lock";

type State =
  | { screen: "idle"; message?: string }
  | { screen: "joining" }
  | { screen: "waiting"; camera: MediaStream }
  | { screen: "active"; camera: MediaStream; remote: MediaStream };

/**
 * The receiver (tablet) view. Idle shows a "Join Call" button for staff;
 * joining turns on the camera and waits, with an End Call button for staff.
 * Calls are answered automatically and there's nothing to tap during one. A
 * notice shows while a call is connecting or reconnecting. While it's in use
 * (from Join Call until it's idle again) the screen is kept awake. (It's full
 * screen when installed; the page doesn't toggle full screen itself, because
 * the browser shows a distracting notice each time.)
 */
export function mountReceiver(
  root: HTMLElement,
  /** Starts a session (when staff tap Join Call). */
  start: (onEvent: (event: ReceiverEvent) => void) => ReceiverSession,
  /** Called when the view comes into use; the result is called when it's idle again. */
  inUse: () => Release = keepAwake,
): void {
  let release: Release | undefined;
  let session: ReceiverSession | undefined;
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
        const button = element("button", "Join Call");
        button.addEventListener("click", join);
        return state.message ? [button, element("p", state.message)] : [button];
      }
      case "joining":
        return [element("p", "Starting…")];
      case "waiting": {
        if (caller)
          return [element("p", `${caller} is calling…`), video(state.camera, "self-view")];
        const end = element("button", "End Call");
        end.className = "end-call";
        end.addEventListener("click", () => session?.leave());
        return [element("p", "Waiting for a call…"), video(state.camera, "self-view"), end];
      }
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
    media = "connecting";
    roomReconnecting = false;
    caller = undefined;
    render({ screen: "joining" });
    session = start((event) => {
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
          render(event.reason ? { screen: "idle", message: event.reason } : { screen: "idle" });
          return;
      }
    });
  };

  render({ screen: "idle" });
}
