import { describe, expect, it } from "vitest";
import { roomUrl } from "./room-url";

describe("roomUrl", () => {
  it("is the group's room for this page, using wss on https pages", () => {
    expect(roomUrl(new URL("https://example.com/smith/"), "p1")).toBe(
      "wss://example.com/smith/api/room?page=p1",
    );
  });

  it("uses ws on http pages, keeps the port and drops the page's query", () => {
    expect(roomUrl(new URL("http://localhost:8787/smith/?x=1"), "p1")).toBe(
      "ws://localhost:8787/smith/api/room?page=p1",
    );
  });
});
