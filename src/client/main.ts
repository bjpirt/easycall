import { roomRole } from "../shared/roles";
import { connectCaller } from "./caller-session";
import { mountCaller } from "./caller-view";
import { blockPinchZoom, element, lockZoom } from "./dom";
import { fetchIceServers, fetchMe, roomUrl } from "./api";
import { createPeer } from "./peer";
import { startReceiver } from "./receiver-session";
import { mountReceiver } from "./receiver-view";
import type { SessionDeps } from "./sessions";
import { watchForUpdates } from "./updates";
import { keepAwake, type Release } from "./wake-lock";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app");

const updates = watchForUpdates();

/** This page load, so the room can tell it apart from other pages signed in as us. */
const pageId = crypto.randomUUID();

/** While a view is in use, keep the screen awake and hold off updating the page. */
function inUse(): Release {
  updates.busy();
  const release = keepAwake();
  return () => {
    release();
    updates.idle();
  };
}

/** Asks who we are in this group, then shows the receiver or caller view. */
async function start(root: HTMLElement): Promise<void> {
  const page = new URL(location.href);
  const result = await fetchMe(page);

  switch (result.type) {
    case "signed-out": {
      const signIn = element("a", "Sign in");
      signIn.href = `/login?next=${encodeURIComponent(page.pathname)}`;
      showMessage(root, "Please sign in to continue.", signIn);
      return;
    }
    case "not-member":
      showMessage(
        root,
        "You're not a member of this group. Check the link, or ask whoever sent it.",
      );
      return;
    case "error":
      showMessage(root, "Something went wrong. Please reload the page.");
      return;
    case "member":
      break;
  }

  const { role, name, receiverName } = result.me;
  const deps: SessionDeps = {
    getCamera: () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
    getIceServers: () => fetchIceServers(page),
    connect: () => new WebSocket(roomUrl(page, pageId)),
    createPeer,
    onVersion: updates.noteVersion,
  };
  blockPinchZoom(root);
  if (roomRole(role) === "receiver") {
    lockZoom();
    mountReceiver(root, (onEvent) => startReceiver(deps, onEvent), inUse);
  } else {
    mountCaller(root, { name, receiverName }, (onEvent) => connectCaller(deps, onEvent), inUse);
  }
}

function showMessage(root: HTMLElement, text: string, ...extra: HTMLElement[]): void {
  root.className = "message";
  root.replaceChildren(element("p", text), ...extra);
}

void start(root);
