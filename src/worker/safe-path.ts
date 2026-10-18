/** Only same-site paths, so a `next` parameter can't send anyone to another site. */
export function safePath(next: string | null): string {
  return next?.startsWith("/") && !next.startsWith("//") && !next.includes("\\") ? next : "/";
}
