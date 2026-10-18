import { connectCaller } from "./caller-session";
import { mountCaller } from "./caller-view";
import { createPeer } from "./peer";
import { receiverStarter } from "./receiver-session";
import { mountReceiver } from "./receiver-view";
import { roomUrl } from "./room-url";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app");

const page = new URL(location.href);
const deps = {
  getCamera: () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
  createPeer,
};

// Dev-only role switch until real identity arrives (step 15).
switch (page.searchParams.get("role")) {
  case "receiver":
    mountReceiver(
      root,
      receiverStarter({ ...deps, connect: () => new WebSocket(roomUrl(page, "receiver")) }),
    );
    break;
  case "caller":
    mountCaller(root, (onEvent) =>
      connectCaller({ ...deps, connect: () => new WebSocket(roomUrl(page, "caller")) }, onEvent),
    );
    break;
  default: {
    const heading = document.createElement("h1");
    heading.textContent = "easyCall";
    root.replaceChildren(heading);
  }
}
