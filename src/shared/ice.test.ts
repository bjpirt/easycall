import { describe, expect, it } from "vitest";
import { parseIceServers } from "./ice";

describe("parseIceServers", () => {
  it("accepts Cloudflare's response, dropping port 53 URLs", () => {
    const servers = [
      { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turn:turn.cloudflare.com:53?transport=udp",
          "turns:turn.cloudflare.com:443?transport=tcp",
        ],
        username: "user",
        credential: "secret",
      },
    ];

    expect(parseIceServers(servers)).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478"] },
      {
        urls: [
          "turn:turn.cloudflare.com:3478?transport=udp",
          "turns:turn.cloudflare.com:443?transport=tcp",
        ],
        username: "user",
        credential: "secret",
      },
    ]);
  });

  it("accepts a single URL string", () => {
    expect(parseIceServers([{ urls: "stun:example.com:3478" }])).toEqual([
      { urls: ["stun:example.com:3478"] },
    ]);
  });

  it("drops servers left with no usable URLs", () => {
    expect(parseIceServers([{ urls: ["stun:example.com:53"] }])).toEqual([]);
  });

  it.each([
    ["not an array", { urls: [] }],
    ["a non-object entry", ["stun:example.com"]],
    ["non-string URLs", [{ urls: [42] }]],
    ["missing URLs", [{ username: "x" }]],
  ])("rejects %s", (_, value) => {
    expect(parseIceServers(value)).toBeUndefined();
  });
});
