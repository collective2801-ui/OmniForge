export const ROLES = Object.freeze({
  USER: 'user',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin',
});

export const DEFAULT_ROLE = ROLES.USER;

export const ROLE_PRIORITY = Object.freeze({
  [ROLES.USER]: 0,
  [ROLES.ADMIN]: 1,
  [ROLES.SUPER_ADMIN]: 2,
});

export function normalizeRole(role) {
  const normalizedRole =
    typeof role === 'string' ? role.trim().toLowerCase() : '';

  return Object.values(ROLES).includes(normalizedRole)
    ? normalizedRole
    : DEFAULT_ROLE;
}

export function getRolePriority(role) {
  return ROLE_PRIORITY[normalizeRole(role)] ?? ROLE_PRIORITY[DEFAULT_ROLE];
}

export function hasRoleOrHigher(role, minimumRole) {
  return getRolePriority(role) >= getRolePriority(minimumRole);
}

export default ROLES;
