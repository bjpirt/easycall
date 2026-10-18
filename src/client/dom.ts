export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (text !== undefined) el.textContent = text;
  return el;
}

/** A playing video for a stream. The self-view is muted so we don't hear ourselves. */
export function video(stream: MediaStream, kind: "self-view" | "remote-view"): HTMLVideoElement {
  const el = element("video");
  el.className = kind;
  el.muted = kind === "self-view";
  el.autoplay = true;
  el.playsInline = true;
  el.srcObject = stream;
  return el;
}
