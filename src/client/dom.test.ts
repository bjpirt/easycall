import { describe, expect, it } from "vitest";
import { notice, setNotice } from "./dom";

describe("notice", () => {
  it("starts hidden, shows text, and hides again when there's nothing to say", () => {
    const el = notice();
    expect(el.hidden).toBe(true);

    setNotice(el, "Reconnecting…");
    expect([el.textContent, el.hidden]).toEqual(["Reconnecting…", false]);

    setNotice(el, undefined);
    expect([el.textContent, el.hidden]).toEqual(["", true]);
  });
});
