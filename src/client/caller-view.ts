import type { Status } from "../shared/protocol";
import type { CallerEvent, CallerSession } from "./caller-session";
import { callNotice, type MediaState } from "./call-status";
import { element, video } from "./dom";

type Screen =
  | { screen: "idle"; message?: string }
  | { screen: "joining" }
  | { screen: "calling"; camera: MediaStream }
  | { screen: "active"; camera: MediaStream; remote: MediaStream };

type Availability = Status | "connecting" | "reconnecting" | "disconnected";

function statusText(availability: Availability, name: string): string {
  switch (availability) {
    case "connecting":
      return "Connecting…";
    case "reconnecting":
      return "Reconnecting…";
    case "unavailable":
      return `${name} isn't available right now`;
    case "available":
      return `${name} is ready for a call`;
    case "in-call":
      return `${name} is in a call`;
    case "disconnected":
      return "Disconnected. Reload the page to try again.";
  }
}

/**
 * The caller (family) view. Idle shows the receiver's availability, and "Join
 * call" is only enabled while they're waiting. During a call the receiver fills
 * the screen, with your own camera in the corner, a Hang up button, and a notice
 * while it's connecting or reconnecting.
 */
export function mountCaller(
  root: HTMLElement,
  /** What the receiver is called, e.g. "Grandma". */
  displayName: string,
  connect: (onEvent: (event: CallerEvent) => void) => CallerSession,
): void {
  let availability: Availability = "connecting";
  let screen: Screen = { screen: "idle" };
  let media: MediaState = "connecting";
  let roomReconnecting = false;
  /** Updated in place, so the videos aren't rebuilt (which would make them flash). */
  const notice = element("p");
  notice.className = "notice";

  const render = (next: Screen = screen): void => {
    screen = next;
    root.className = `call caller ${screen.screen}`;
    root.replaceChildren(...view());
    updateNotice();
  };

  const updateNotice = (): void => {
    const text =
      screen.screen === "calling"
        ? roomReconnecting
          ? "Reconnecting…"
          : "Calling…"
        : callNotice(media, roomReconnecting);
    notice.textContent = text ?? "";
    notice.hidden = text === undefined;
  };

  const view = (): HTMLElement[] => {
    switch (screen.screen) {
      case "idle": {
        const join = element("button", "Join call");
        join.disabled = availability !== "available";
        join.addEventListener("click", () => {
          render({ screen: "joining" });
          session.join();
        });
        const elements = [element("p", statusText(availability, displayName)), join];
        return screen.message ? [...elements, element("p", screen.message)] : elements;
      }
      case "joining":
        return [element("p", "Starting…")];
      case "calling":
        return [notice, video(screen.camera, "self-view"), hangUp()];
      case "active":
        return [
          video(screen.remote, "remote-view"),
          video(screen.camera, "self-view"),
          notice,
          hangUp(),
        ];
    }
  };

  const hangUp = (): HTMLButtonElement => {
    const button = element("button", "Hang up");
    button.className = "hang-up";
    button.addEventListener("click", () => {
      session.hangUp();
    });
    return button;
  };

  const session = connect((event) => {
    switch (event.type) {
      case "status":
        availability = event.status;
        if (screen.screen === "idle") render();
        return;
      case "connection":
        roomReconnecting = event.state === "reconnecting";
        // Once reconnected, the room sends the status again.
        if (event.state !== "connected") {
          availability = event.state === "reconnecting" ? "reconnecting" : "disconnected";
        }
        if (screen.screen === "idle") render();
        else updateNotice();
        return;
      case "calling":
        media = "connecting";
        render({ screen: "calling", camera: event.camera });
        return;
      case "remote":
        render({ screen: "active", camera: event.camera, remote: event.remote });
        return;
      case "media":
        media = event.state;
        updateNotice();
        return;
      case "call-ended":
        render(event.reason ? { screen: "idle", message: event.reason } : { screen: "idle" });
        return;
    }
  });

  render();
}
