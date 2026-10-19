import { describe, expect, it, vi } from "vitest";
import { stunOnly } from "../shared/ice";
import { fetchIceServers, fetchMe, roomUrl } from "./api";

const page = new URL("https://example.com/smith/");
const respond = (response: Response | Error) =>
  vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );

describe("fetchMe", () => {
  it("asks the group's API who we are", async () => {
    const me = { email: "ben@example.com", name: "Ben", role: "admin", receiverName: "Grandma" };
    const fetcher = respond(Response.json(me));

    expect(await fetchMe(page, fetcher)).toEqual({ type: "member", me });
    expect(fetcher).toHaveBeenCalledWith(new URL("https://example.com/smith/api/me"));
  });

  it.each([
    [401, "signed-out"],
    [404, "not-member"],
    [500, "error"],
  ])("maps %i to %s", async (status, type) => {
    expect(await fetchMe(page, respond(new Response("", { status })))).toEqual({ type });
  });

  it("treats a malformed response or network failure as an error", async () => {
    expect(await fetchMe(page, respond(Response.json({ nope: 1 })))).toEqual({ type: "error" });
    expect(await fetchMe(page, respond(new Error("offline")))).toEqual({ type: "error" });
  });
});

const turn = { urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "c" };

describe("fetchIceServers", () => {
  it("returns the Worker's ICE servers", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ iceServers: [turn] })),
    );

    expect(await fetchIceServers(page, fetcher)).toEqual([turn]);
    expect(fetcher).toHaveBeenCalledWith(new URL("https://example.com/smith/api/ice-servers"));
  });

  it.each([
    ["an error status", () => Promise.resolve(new Response("", { status: 500 }))],
    ["a bad body", () => Promise.resolve(Response.json({ nope: true }))],
    ["a network failure", () => Promise.reject(new Error("offline"))],
  ])("falls back to STUN only on %s", async (_, respond) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await fetchIceServers(page, vi.fn<typeof fetch>(respond))).toEqual(stunOnly);
  });
});

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
