export interface Group {
  slug: string;
  /** What callers see the receiver called, e.g. "Grandma". */
  displayName: string;
}

/** Who's in which group. Read through this interface so storage can change (env var now, D1 later). */
export interface Directory {
  group: (slug: string) => Group | undefined;
}

/** A group's slug is its URL path: lowercase letters, digits and hyphens. */
export const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * Reads the directory from the `DIRECTORY` secret (JSON), e.g.
 * `{"groups":{"smith":{"displayName":"Grandma"}}}`. Invalid entries are skipped
 * and a missing or unreadable directory is empty, so nothing is accessible.
 */
export function parseDirectory(json: string | undefined): Directory {
  const groups = new Map<string, Group>();
  for (const [slug, value] of Object.entries(readGroups(json))) {
    const displayName = (value as { displayName?: unknown } | null)?.displayName;
    if (slugPattern.test(slug) && typeof displayName === "string" && displayName.trim()) {
      groups.set(slug, { slug, displayName });
    } else {
      console.error(`Ignoring invalid group "${slug}" in DIRECTORY`);
    }
  }
  return { group: (slug) => groups.get(slug) };
}

function readGroups(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    const groups = (value as { groups?: unknown } | null)?.groups;
    if (typeof groups === "object" && groups !== null && !Array.isArray(groups)) {
      return groups as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  console.error('DIRECTORY isn\'t valid JSON of the form {"groups": {...}}');
  return {};
}
