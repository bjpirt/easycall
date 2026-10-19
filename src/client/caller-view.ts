import type { Status } from "../shared/protocol";
import type { CallerEvent, CallerSession } from "./caller-session";
import { callNotice, type MediaState } from "./call-status";
import { element, nameLabel, notice as noticeElement, setNotice, video } from "./dom";
import { keepAwake, whileInUse, type Release } from "./wake-lock";

type Screen =
  | { screen: "idle"; message?: string }
  | { screen: "joining" }
  | { screen: "calling"; camera: MediaStream }
  | { screen: "active"; camera: MediaStream; remote: MediaStream };

type Availability = Status | "connecting" | "reconnecting" | "disconnected";

function statusText(
  availability: Availability,
  name: string,
  caller?: string,
  rejoin?: boolean,
): string {
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
      if (rejoin) return `Your call with ${name} is still going`;
      return caller ? `${name} is in a call with ${caller}` : `${name} is in a call`;
    case "disconnected":
      return "Disconnected. Reload the page to try again.";
  }
}

/**
 * The caller (family) view. Idle shows the receiver's availability, with Join
 * Call enabled only while they're waiting (or Re-join Call, to get back into our
 * own call after it dropped, e.g. the app was closed and reopened). During a
 * call the receiver fills the screen, with your own camera in the corner, an
 * End Call button, and a notice while it's connecting or reconnecting. While
 * it's in use (from Join Call until the call ends) the screen is kept awake.
 */
export function mountCaller(
  root: HTMLElement,
  /** Your name and the receiver's, e.g. "Ben" and "Grandma". */
  { name, receiverName }: { name: string; receiverName: string },
  connect: (onEvent: (event: CallerEvent) => void) => CallerSession,
  /** Called when the view comes into use; the result is called when it's idle again. */
  inUse: () => Release = keepAwake,
): void {
  const setInUse = whileInUse(inUse);
  let availability: Availability = "connecting";
  /** Who's in a call with the receiver, if anyone. */
  let inCallWith: string | undefined;
  /** Whether that call is ours, dropped (e.g. the app was closed), and can be joined again. */
  let canRejoin = false;
  let screen: Screen = { screen: "idle" };
  let media: MediaState = "connecting";
  let roomReconnecting = false;
  const notice = noticeElement();

  const render = (next: Screen = screen): void => {
    screen = next;
    // The video screens can't be zoomed (a stray pinch would crop the call); idle can.
    const zoom = screen.screen === "calling" || screen.screen === "active" ? " no-zoom" : "";
    root.className = `call caller ${screen.screen}${zoom}`;
    root.replaceChildren(...view());
    updateNotice();
    setInUse(screen.screen !== "idle");
  };

  const updateNotice = (): void => {
    if (screen.screen !== "calling") setNotice(notice, callNotice(media, roomReconnecting));
    else setNotice(notice, roomReconnecting ? "Reconnecting…" : "Calling…");
  };

  const view = (): HTMLElement[] => {
    switch (screen.screen) {
      case "idle": {
        const join = element("button", canRejoin ? "Re-join Call" : "Join Call");
        join.disabled = availability !== "available" && !canRejoin;
        join.addEventListener("click", () => {
          render({ screen: "joining" });
          session.join();
        });
        const signedIn = element("p", `Signed in as ${name}`);
        signedIn.className = "signed-in";
        const elements = [
          element("p", statusText(availability, receiverName, inCallWith, canRejoin)),
          join,
        ];
        if (screen.message) elements.push(element("p", screen.message));
        return [...elements, signedIn];
      }
      case "joining":
        return [element("p", "Starting…")];
      case "calling":
        return [notice, video(screen.camera, "self-view"), hangUp()];
      case "active":
        return [
          video(screen.remote, "remote-view"),
          nameLabel(receiverName),
          video(screen.camera, "self-view"),
          notice,
          hangUp(),
        ];
    }
  };

  const hangUp = (): HTMLButtonElement => {
    const button = element("button", "End Call");
    button.className = "end-call";
    button.addEventListener("click", () => {
      session.hangUp();
    });
    return button;
  };

  const session = connect((event) => {
    switch (event.type) {
      case "status":
        availability = event.status;
        inCallWith = event.caller;
        canRejoin = event.rejoin === true;
        if (screen.screen === "idle") render();
        return;
      case "connection":
        roomReconnecting = event.state === "reconnecting";
        // Once reconnected, the room sends the status again.
        if (event.state !== "connected") {
          availability = event.state === "reconnecting" ? "reconnecting" : "disconnected";
          canRejoin = false;
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
      case "ended":
        render(event.reason ? { screen: "idle", message: event.reason } : { screen: "idle" });
        return;
    }
  });

  render();
}
