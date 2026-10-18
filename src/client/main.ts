import { mountReceiver } from "./receiver";
import { roomUrl } from "./room-url";
import "./style.css";

const root = document.querySelector<HTMLElement>("#app");
if (!root) throw new Error("Missing #app");

// Dev-only role switch until real identity arrives (step 15).
const page = new URL(location.href);
if (page.searchParams.get("role") === "receiver") {
  mountReceiver(root, {
    getCamera: () => navigator.mediaDevices.getUserMedia({ video: true, audio: true }),
    connect: () => new WebSocket(roomUrl(page, "receiver")),
  });
} else {
  const heading = document.createElement("h1");
  heading.textContent = "easyCall";
  root.replaceChildren(heading);
}
