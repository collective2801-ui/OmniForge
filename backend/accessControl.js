import {
  DEFAULT_ROLE,
  ROLES,
  hasRoleOrHigher,
  normalizeRole,
} from './roles.js';

const FEATURE_ACCESS = Object.freeze({
  run_builds: [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  deploy_projects: [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  manage_domains: [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  manage_integrations: [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  mobile_builder: [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  view_runtime_status: [ROLES.USER, ROLES.ADMIN, ROLES.SUPER_ADMIN],
  control_deployments: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
  view_all_projects: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
  view_platform_sessions: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
  manage_roles: [ROLES.ADMIN, ROLES.SUPER_ADMIN],
  override_billing: [ROLES.SUPER_ADMIN],
  unlimited_builds: [ROLES.SUPER_ADMIN],
  access_all_features: [ROLES.SUPER_ADMIN],
});

function resolveUserRole(user) {
  if (!user || typeof user !== 'object') {
    return DEFAULT_ROLE;
  }

  return normalizeRole(
    user.role ??
      user.access?.role ??
      user.app_metadata?.role ??
      user.user_metadata?.role,
  );
}

export function isSuperAdmin(user) {
  return resolveUserRole(user) === ROLES.SUPER_ADMIN;
}

export function hasAccess(user, feature) {
  if (isSuperAdmin(user)) {
    return true;
  }

  if (typeof feature !== 'string' || feature.trim().length === 0) {
    return false;
  }

  const featureKey = feature.trim();
  const allowedRoles = FEATURE_ACCESS[featureKey];

  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    return false;
  }

  const role = resolveUserRole(user);
  return allowedRoles.some((allowedRole) => hasRoleOrHigher(role, allowedRole));
}

export function getAccessProfile(user) {
  const role = resolveUserRole(user);
  const features = Object.keys(FEATURE_ACCESS).filter((feature) =>
    hasAccess({ ...(user ?? {}), role }, feature),
  );

  return {
    role,
    isSuperAdmin: role === ROLES.SUPER_ADMIN,
    unlimitedBuilds: hasAccess({ ...(user ?? {}), role }, 'unlimited_builds'),
    canOverrideBilling: hasAccess({ ...(user ?? {}), role }, 'override_billing'),
    canControlDeployments: hasAccess(
      { ...(user ?? {}), role },
      'control_deployments',
    ),
    canViewAllProjects: hasAccess({ ...(user ?? {}), role }, 'view_all_projects'),
    features,
  };
}

export default {
  hasAccess,
  isSuperAdmin,
  getAccessProfile,
};
