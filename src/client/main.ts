import { isRole } from "../shared/roles";
import { mountCallView } from "./call-view";
import { createPeer } from "./peer";
import { roomUrl } from "./room-url";
import { sessionStarter } from "./session";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app");

const page = new URL(location.href);
// Dev-only role switch until real identity arrives (step 15).
const role = page.searchParams.get("role");

if (isRole(role)) {
  const start = sessionStarter(role, {
    getCamera: () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
    connect: (r) => new WebSocket(roomUrl(page, r)),
    createPeer: (options) => createPeer(options),
  });
  mountCallView(root, role, start);
} else {
  const heading = document.createElement("h1");
  heading.textContent = "easyCall";
  root.replaceChildren(heading);
}
