import { describe, expect, it, vi } from "vitest";
import { stunOnly } from "../shared/ice";
import { fetchIceServers } from "./ice";

const turn = { urls: ["turn:turn.cloudflare.com:3478"], username: "u", credential: "c" };

describe("fetchIceServers", () => {
  it("returns the Worker's ICE servers", async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ iceServers: [turn] })),
    );

    expect(await fetchIceServers(fetcher)).toEqual([turn]);
    expect(fetcher).toHaveBeenCalledWith("/api/ice-servers");
  });

  it.each([
    ["an error status", () => Promise.resolve(new Response("", { status: 500 }))],
    ["a bad body", () => Promise.resolve(Response.json({ nope: true }))],
    ["a network failure", () => Promise.reject(new Error("offline"))],
  ])("falls back to STUN only on %s", async (_, respond) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await fetchIceServers(vi.fn<typeof fetch>(respond))).toEqual(stunOnly);
  });
});
