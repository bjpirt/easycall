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

/**
 * A notice over a call screen ("Connecting…", "Reconnecting…"). Kept and updated
 * in place with `setNotice`, so the videos around it aren't rebuilt (which would
 * make them flash).
 */
export function notice(): HTMLElement {
  const el = element("p");
  el.className = "notice";
  el.hidden = true;
  return el;
}

/** Shows `text` in a notice, or hides it if there's nothing to say. */
export function setNotice(el: HTMLElement, text: string | undefined): void {
  el.textContent = text ?? "";
  el.hidden = text === undefined;
}

/** A name shown over someone's video, so you can see who's on the call. */
export function nameLabel(name: string): HTMLElement {
  const el = element("p", name);
  el.className = "name-label";
  return el;
}

/** The parts of the page that track its visibility (so tests can pass a fake). */
export interface Page {
  visibilityState: DocumentVisibilityState;
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}
