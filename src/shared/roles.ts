export const roles = ["receiver", "caller"] as const;

export type Role = (typeof roles)[number];

export function isRole(value: unknown): value is Role {
  return roles.includes(value as Role);
}
