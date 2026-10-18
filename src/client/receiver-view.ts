import { element, video } from "./dom";
import type { StartReceiver } from "./receiver-session";

type State =
  | { screen: "idle"; error?: string }
  | { screen: "joining" }
  | { screen: "waiting"; camera: MediaStream }
  | { screen: "active"; camera: MediaStream; remote: MediaStream };

/**
 * The receiver (tablet) view. Idle shows a "Join call" button for staff;
 * joining turns on the camera and waits. Calls are answered automatically and
 * there's nothing to tap once joined.
 */
export function mountReceiver(root: HTMLElement, start: StartReceiver): void {
  const render = (state: State): void => {
    root.className = `call receiver ${state.screen}`;
    root.replaceChildren(...view(state));
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
        return [element("p", "Waiting for a call…"), video(state.camera, "self-view")];
      case "active":
        return [video(state.remote, "remote-view"), video(state.camera, "self-view")];
    }
  };

  const join = (): void => {
    render({ screen: "joining" });
    start((event) => {
      switch (event.type) {
        case "waiting":
          render({ screen: "waiting", camera: event.camera });
          return;
        case "remote":
          render({ screen: "active", camera: event.camera, remote: event.remote });
          return;
        case "ended":
          render(event.reason ? { screen: "idle", error: event.reason } : { screen: "idle" });
          return;
      }
    });
  };

  render({ screen: "idle" });
}
