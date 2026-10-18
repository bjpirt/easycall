import { describe, expect, it } from "vitest";
import { roomUrl } from "./room-url";

describe("roomUrl", () => {
  it("uses wss on https pages", () => {
    expect(roomUrl(new URL("https://example.com/smith/"), "receiver")).toBe(
      "wss://example.com/api/room?role=receiver",
    );
  });

  it("uses ws on http pages and keeps the port", () => {
    expect(roomUrl(new URL("http://localhost:8787/"), "caller")).toBe(
      "ws://localhost:8787/api/room?role=caller",
    );
  });
});
