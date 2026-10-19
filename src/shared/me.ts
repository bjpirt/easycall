import { isMemberRole, type MemberRole } from "./roles";

/** `/<group>/api/me`: who you are in this group. */
export interface Me {
  email: string;
  /** Your name in this group, e.g. "Ben". */
  name: string;
  role: MemberRole;
  /** The receiver's name, e.g. "Grandma". */
  receiverName: string;
}

export function parseMe(value: unknown): Me | undefined {
  const { email, name, role, receiverName } = (value ?? {}) as Record<string, unknown>;
  return typeof email === "string" &&
    typeof name === "string" &&
    isMemberRole(role) &&
    typeof receiverName === "string"
    ? { email, name, role, receiverName }
    : undefined;
}
