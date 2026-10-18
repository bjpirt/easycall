import { describe, expect, it, vi } from "vitest";
import { stunOnly } from "../shared/ice";
import { iceServers } from "./turn";

const env = { TURN_KEY_ID: "key-id", TURN_KEY_API_TOKEN: "token" };
const turn = {
  urls: [
    "turn:turn.cloudflare.com:3478?transport=udp",
    "turn:turn.cloudflare.com:53?transport=udp",
  ],
  username: "u",
  credential: "c",
};

function fakeFetch(response: Response) {
  return vi.fn<typeof fetch>(() => Promise.resolve(response));
}

describe("iceServers", () => {
  it("uses STUN only when TURN isn't configured", async () => {
    const fetcher = fakeFetch(Response.json({}));

    expect(await iceServers({}, fetcher)).toEqual(stunOnly);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("asks Cloudflare for a day's credentials with the key's token", async () => {
    const fetcher = fakeFetch(Response.json({ iceServers: [turn] }));

    await iceServers(env, fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer token" }) as unknown,
        body: JSON.stringify({ ttl: 86400 }),
      }),
    );
  });

  it("returns the TURN servers without port 53", async () => {
    const servers = await iceServers(env, fakeFetch(Response.json({ iceServers: [turn] })));

    expect(servers).toEqual([
      { urls: ["turn:turn.cloudflare.com:3478?transport=udp"], username: "u", credential: "c" },
    ]);
  });

  it.each([
    ["an error status", () => fakeFetch(new Response("nope", { status: 401 }))],
    ["an unexpected body", () => fakeFetch(Response.json({ something: "else" }))],
    ["a network failure", () => vi.fn<typeof fetch>(() => Promise.reject(new Error("offline")))],
  ])("falls back to STUN only on %s", async (_, makeFetcher) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(await iceServers(env, makeFetcher())).toEqual(stunOnly);
  });
});
