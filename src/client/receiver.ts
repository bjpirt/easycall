/** The parts of a WebSocket the receiver uses (so tests can pass a fake). */
export type RoomSocket = Pick<WebSocket, "addEventListener" | "close">;

export interface ReceiverDeps {
  getCamera: () => Promise<MediaStream>;
  connect: () => RoomSocket;
}

type State =
  | { screen: "idle"; error?: string }
  | { screen: "joining" }
  | { screen: "waiting"; camera: MediaStream };

/**
 * The receiver (tablet) view. Idle shows a "Join call" button for staff;
 * joining turns on the camera, connects to the room and waits for a caller.
 */
export function mountReceiver(root: HTMLElement, deps: ReceiverDeps): void {
  let camera: MediaStream | undefined;

  const render = (state: State): void => {
    root.className = `receiver ${state.screen}`;
    root.replaceChildren(...view(state));
  };

  const view = (state: State): HTMLElement[] => {
    switch (state.screen) {
      case "idle": {
        const button = element("button", "Join call");
        button.addEventListener("click", () => void join());
        return state.error ? [button, element("p", state.error)] : [button];
      }
      case "joining":
        return [element("p", "Starting…")];
      case "waiting": {
        const selfView = element("video");
        selfView.className = "self-view";
        selfView.muted = true;
        selfView.autoplay = true;
        selfView.playsInline = true;
        selfView.srcObject = state.camera;
        return [element("p", "Waiting for a call…"), selfView];
      }
    }
  };

  const leave = (error: string): void => {
    for (const track of camera?.getTracks() ?? []) track.stop();
    camera = undefined;
    render({ screen: "idle", error });
  };

  const join = async (): Promise<void> => {
    render({ screen: "joining" });
    try {
      camera = await deps.getCamera();
    } catch {
      render({ screen: "idle", error: "Couldn't start the camera." });
      return;
    }
    const stream = camera;
    const socket = deps.connect();
    socket.addEventListener("open", () => {
      render({ screen: "waiting", camera: stream });
    });
    // Reconnecting comes later (step 23); for now losing the room ends the session.
    socket.addEventListener("close", () => {
      leave("Lost connection.");
    });
  };

  render({ screen: "idle" });
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
}
