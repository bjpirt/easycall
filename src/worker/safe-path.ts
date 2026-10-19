/**
 * Where to go after signing in: `next` if it's a page on this site, otherwise
 * the home page, so a `next` parameter can't send anyone to another site. It's
 * resolved the way a browser would (which, for example, ignores tabs and
 * newlines, so `/<tab>/evil.com` means `//evil.com`), and only its path is kept.
 */
export function safePath(next: string | null, site: URL): string {
  if (!next?.startsWith("/")) return "/";
  try {
    const url = new URL(next, site);
    return url.origin === site.origin ? url.pathname + url.search + url.hash : "/";
  } catch {
    return "/";
  }
}
