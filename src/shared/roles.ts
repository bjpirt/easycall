/** Roles in a room: the receiver (being called) and callers. */
export const roles = ["receiver", "caller"] as const;

export type Role = (typeof roles)[number];

export function isRole(value: unknown): value is Role {
  return roles.includes(value as Role);
}

/** A user's role in a group. An admin can also do everything a caller can. */
export const memberRoles = ["receiver", "caller", "admin"] as const;

export type MemberRole = (typeof memberRoles)[number];

export function isMemberRole(value: unknown): value is MemberRole {
  return memberRoles.includes(value as MemberRole);
}

/** The role a member takes in the room: admins call like any other caller. */
export function roomRole(role: MemberRole): Role {
  return role === "admin" ? "caller" : role;
}
