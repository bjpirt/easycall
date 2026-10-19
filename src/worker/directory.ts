import { isMemberRole, type MemberRole } from "../shared/roles";

export interface Group {
  slug: string;
  /** The receiver's name, e.g. "Grandma": what callers see the group as. */
  receiverName: string;
}

export interface Member {
  role: MemberRole;
  /** What others in the group see this person called (per group). */
  name: string;
}

/** Who's in which group. Read through this interface so storage can change (env var now, D1 later). */
export interface Directory {
  group: (slug: string) => Group | undefined;
  /** A user's membership of a group, or `undefined` if they aren't a member. Emails are case-insensitive. */
  member: (slug: string, email: string) => Member | undefined;
  /** The group a user is in (each person is in at most one), or `undefined` if none. */
  groupOf: (email: string) => Group | undefined;
  /** Every member's email, across all groups (e.g. to check the Access policy allows them). */
  emails: () => string[];
}

/** A group's key is its URL path: lowercase letters, digits and hyphens. */
export const slugPattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

interface GroupEntry extends Group {
  members: Map<string, Member>;
}

/**
 * Reads the directory from the `DIRECTORY` secret (JSON), e.g.
 *
 *   {"groups": {"smith": {"members": {
 *     "tablet@example.com": {"role": "receiver", "name": "Grandma"},
 *     "ben@example.com": {"role": "admin", "name": "Ben"} }}}}
 *
 * Every member needs a role and a name; invalid members are skipped. Each person
 * can only be in one group: if they're listed again in a later group, that entry
 * is skipped. Every group needs exactly one receiver (whose name is what callers
 * see); other invalid groups are skipped entirely. A missing or unreadable directory is empty, so
 * nothing is accessible. Each problem is reported to `onProblem` (logged by default).
 */
export function parseDirectory(
  json: string | undefined,
  onProblem: (problem: string) => void = (problem) => {
    console.error(`DIRECTORY: ${problem}`);
  },
): Directory {
  const groups = new Map<string, GroupEntry>();
  /** Which group each email is in. */
  const groupOf = new Map<string, string>();
  for (const [slug, value] of Object.entries(readGroups(json, onProblem))) {
    const group = parseGroup(slug, value, groupOf, onProblem);
    if (!group) continue;
    groups.set(slug, group);
    for (const email of group.members.keys()) groupOf.set(email, slug);
  }
  const group = (slug: string | undefined): Group | undefined => {
    const entry = slug === undefined ? undefined : groups.get(slug);
    return entry && { slug: entry.slug, receiverName: entry.receiverName };
  };
  return {
    group,
    member: (slug, email) => groups.get(slug)?.members.get(normaliseEmail(email)),
    groupOf: (email) => group(groupOf.get(normaliseEmail(email))),
    emails: () => [...new Set([...groups.values()].flatMap((g) => [...g.members.keys()]))].sort(),
  };
}

/** Every problem with a directory: empty means it's valid. */
export function directoryProblems(json: string): string[] {
  const problems: string[] = [];
  parseDirectory(json, (problem) => problems.push(problem));
  return problems;
}

function parseGroup(
  slug: string,
  value: unknown,
  /** Emails already in an earlier group, and which. */
  taken: ReadonlyMap<string, string>,
  onProblem: (problem: string) => void,
): GroupEntry | undefined {
  if (!slugPattern.test(slug)) {
    onProblem(`group "${slug}" isn't a valid URL name (lowercase letters, digits and hyphens)`);
    return undefined;
  }

  const members = new Map<string, Member>();
  const { members: raw } = (value ?? {}) as { members?: unknown };
  for (const [email, entry] of Object.entries(isRecord(raw) ? raw : {})) {
    const member = parseMember(entry);
    const other = taken.get(normaliseEmail(email));
    if (!email.includes("@")) onProblem(`group "${slug}": "${email}" isn't an email address`);
    else if (!member) {
      onProblem(`group "${slug}": ${email} needs a role (receiver, caller or admin) and a name`);
    } else if (other) {
      onProblem(`group "${slug}": ${email} is already in group "${other}" (one group per person)`);
    } else members.set(normaliseEmail(email), member);
  }

  const receivers = [...members.values()].filter((m) => m.role === "receiver");
  const [receiver] = receivers;
  if (receivers.length !== 1 || !receiver) {
    onProblem(`group "${slug}" needs exactly one receiver (it has ${String(receivers.length)})`);
    return undefined;
  }
  return { slug, receiverName: receiver.name, members };
}

function parseMember(value: unknown): Member | undefined {
  if (!isRecord(value)) return undefined;
  const { role, name } = value;
  return isMemberRole(role) && typeof name === "string" && name.trim()
    ? { role, name: name.trim() }
    : undefined;
}

function readGroups(
  json: string | undefined,
  onProblem: (problem: string) => void,
): Record<string, unknown> {
  if (!json) return {};
  try {
    const groups = (JSON.parse(json) as { groups?: unknown } | null)?.groups;
    if (isRecord(groups)) return groups;
  } catch {
    // fall through
  }
  onProblem('it isn\'t valid JSON of the form {"groups": {...}}');
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}
