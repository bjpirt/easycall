import { parseMe, type Me } from "../shared/me";

export type MeResult =
  { type: "member"; me: Me } | { type: "signed-out" } | { type: "not-member" } | { type: "error" };

/** Asks the Worker who we are in this page's group (`/<group>/api/me`). */
export async function fetchMe(page: URL, fetcher: typeof fetch = fetch): Promise<MeResult> {
  try {
    const response = await fetcher(new URL("api/me", page));
    if (response.status === 401) return { type: "signed-out" };
    if (response.status === 404) return { type: "not-member" };
    const me = response.ok ? parseMe(await response.json()) : undefined;
    return me ? { type: "member", me } : { type: "error" };
  } catch {
    return { type: "error" };
  }
}
