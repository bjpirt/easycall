import type { Role } from "../shared/roles";
import { element, video } from "./dom";
import type { Session, StartSession } from "./session";

type State =
  | { screen: "idle"; error?: string }
  | { screen: "joining" }
  | { screen: "waiting"; camera: MediaStream }
  | { screen: "active"; camera: MediaStream; remote: MediaStream };

const waitingText: Record<Role, string> = {
  receiver: "Waiting for a call…",
  caller: "Calling…",
};

/**
 * The call screen for either role. Idle shows a "Join call" button; joining
 * turns on the camera and connects. The receiver then waits and answers
 * automatically; the caller calls straight away. Once connected, the other
 * person fills the screen with your own camera in the corner. Only the caller
 * can hang up; the receiver never needs to touch the screen.
 */
export function mountCallView(root: HTMLElement, role: Role, start: StartSession): void {
  let session: Session | undefined;

  const render = (state: State): void => {
    root.className = `call ${role} ${state.screen}`;
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
        return withControls([element("p", waitingText[role]), video(state.camera, "self-view")]);
      case "active":
        return withControls([video(state.remote, "remote-view"), video(state.camera, "self-view")]);
    }
  };

  const withControls = (elements: HTMLElement[]): HTMLElement[] => {
    if (role !== "caller") return elements;
    const hangUp = element("button", "Hang up");
    hangUp.className = "hang-up";
    hangUp.addEventListener("click", () => session?.hangUp());
    return [...elements, hangUp];
  };

  const join = (): void => {
    render({ screen: "joining" });
    session = start((event) => {
      switch (event.type) {
        case "connected":
          render({ screen: "waiting", camera: event.camera });
          return;
        case "remote":
          render({ screen: "active", camera: event.camera, remote: event.remote });
          return;
        case "ended":
          session = undefined;
          render(event.reason ? { screen: "idle", error: event.reason } : { screen: "idle" });
          return;
      }
    });
  };

  render({ screen: "idle" });
}
