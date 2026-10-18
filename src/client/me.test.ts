import { describe, expect, it, vi } from "vitest";
import { fetchMe } from "./me";

const page = new URL("https://example.com/smith/");
const respond = (response: Response | Error) =>
  vi.fn<typeof fetch>(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );

describe("fetchMe", () => {
  it("asks the group's API who we are", async () => {
    const me = { email: "ben@example.com", role: "admin", displayName: "Grandma" };
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
