import { isMemberRole, type MemberRole } from "../shared/roles";

export interface Group {
  slug: string;
  /** What callers see the receiver called, e.g. "Grandma". */
  displayName: string;
}

/** Who's in which group. Read through this interface so storage can change (env var now, D1 later). */
export interface Directory {
  group: (slug: string) => Group | undefined;
  /** A user's role in a group, or `undefined` if they aren't a member. Emails are case-insensitive. */
  role: (slug: string, email: string) => MemberRole | undefined;
}

/** A group's slug is its URL path: lowercase letters, digits and hyphens. */
export const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

interface GroupEntry extends Group {
  members: Map<string, MemberRole>;
}

/**
 * Reads the directory from the `DIRECTORY` secret (JSON), e.g.
 *
 *   {"groups": {"smith": {"displayName": "Grandma", "members": {
 *     "tablet@example.com": "receiver", "ben@example.com": "admin" }}}}
 *
 * Invalid members are skipped. Invalid groups, including ones with more than
 * one receiver, are skipped entirely. A missing or unreadable directory is
 * empty, so nothing is accessible. Problems are logged.
 */
export function parseDirectory(json: string | undefined): Directory {
  const groups = new Map<string, GroupEntry>();
  for (const [slug, value] of Object.entries(readGroups(json))) {
    const group = parseGroup(slug, value);
    if (group) groups.set(slug, group);
  }
  return {
    group: (slug) => {
      const entry = groups.get(slug);
      return entry && { slug: entry.slug, displayName: entry.displayName };
    },
    role: (slug, email) => groups.get(slug)?.members.get(normaliseEmail(email)),
  };
}

function parseGroup(slug: string, value: unknown): GroupEntry | undefined {
  const { displayName, members } = (value ?? {}) as { displayName?: unknown; members?: unknown };
  if (!slugPattern.test(slug) || typeof displayName !== "string" || !displayName.trim()) {
    console.error(`Ignoring invalid group "${slug}" in DIRECTORY`);
    return undefined;
  }

  const entries = new Map<string, MemberRole>();
  const raw = typeof members === "object" && members !== null ? members : {};
  for (const [email, role] of Object.entries(raw)) {
    if (email.includes("@") && isMemberRole(role)) entries.set(normaliseEmail(email), role);
    else console.error(`Ignoring invalid member "${email}" in group "${slug}"`);
  }
  if ([...entries.values()].filter((role) => role === "receiver").length > 1) {
    console.error(`Ignoring group "${slug}": it has more than one receiver`);
    return undefined;
  }
  return { slug, displayName, members: entries };
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

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
