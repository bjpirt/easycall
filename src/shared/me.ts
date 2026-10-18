import { isMemberRole, type MemberRole } from "./roles";

/** `/<group>/api/me`: who you are in this group. */
export interface Me {
  email: string;
  role: MemberRole;
  /** What the receiver is called, e.g. "Grandma". */
  displayName: string;
}

export function parseMe(value: unknown): Me | undefined {
  const { email, role, displayName } = (value ?? {}) as Record<string, unknown>;
  return typeof email === "string" && isMemberRole(role) && typeof displayName === "string"
    ? { email, role, displayName }
    : undefined;
}
