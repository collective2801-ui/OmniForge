import { createHash, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import logger from '../engine/logger.js';
import { getAccessProfile } from './accessControl.js';
import { upsertProfileFromAuthUser } from './profileStore.js';
import { ROLES } from './roles.js';
import {
  isSupabaseAdminConfigured,
  supabaseAdmin,
} from './supabaseClient.js';

const scryptAsync = promisify(scryptCallback);
const MASTER_ACCOUNT_NAMESPACE = 'omniforge-master-account';
const USERS_PAGE_SIZE = 200;

function createErrorResult(message) {
  return {
    ok: false,
    seeded: false,
    status: 'failed',
    user: null,
    error: message,
  };
}

function createSuccessResult(user, status, seeded) {
  return {
    ok: true,
    seeded,
    status,
    user,
    error: null,
  };
}

function getMasterAccountConfig() {
  const email = process.env.MASTER_EMAIL?.trim().toLowerCase() ?? '';
  const password = process.env.MASTER_PASSWORD ?? '';

  if (!email) {
    return {
      ok: false,
      error: 'MASTER_EMAIL is required to seed the master account.',
    };
  }

  if (!password) {
    return {
      ok: false,
      error: 'MASTER_PASSWORD is required to seed the master account.',
    };
  }

  if (password.length < 8) {
    return {
      ok: false,
      error: 'MASTER_PASSWORD must be at least 8 characters long.',
    };
  }

  return {
    ok: true,
    email,
    password,
  };
}

async function createPasswordFingerprint(email, password) {
  const salt = createHash('sha256')
    .update(`${MASTER_ACCOUNT_NAMESPACE}:${email}`)
    .digest('hex');
  const derivedKey = await scryptAsync(password, salt, 64);
  return Buffer.from(derivedKey).toString('hex');
}

function buildRoleMetadata(existingUser, passwordFingerprint) {
  const timestamp = new Date().toISOString();
  const existingAppMetadata = existingUser?.app_metadata ?? {};
  const existingUserMetadata = existingUser?.user_metadata ?? {};

  return {
    email_confirm: true,
    app_metadata: {
      ...existingAppMetadata,
      role: ROLES.SUPER_ADMIN,
      platformAccess: {
        unlimitedBuilds: true,
        accessAllFeatures: true,
        overrideBilling: true,
        controlDeployments: true,
        viewAllProjects: true,
      },
      masterAccount: {
        provider: 'omniforge',
        seededAt: existingAppMetadata.masterAccount?.seededAt ?? timestamp,
        lastSeededAt: timestamp,
        passwordFingerprint,
        passwordAlgorithm: 'scrypt',
        version: 1,
      },
    },
    user_metadata: {
      ...existingUserMetadata,
      role: ROLES.SUPER_ADMIN,
    },
  };
}

function normalizeSeededUser(user) {
  if (!user) {
    return null;
  }

  const access = getAccessProfile({
    role: user.app_metadata?.role ?? user.user_metadata?.role ?? user.role,
  });

  return {
    id: user.id,
    email: user.email ?? '',
    role: access.role,
    access,
    createdAt: user.created_at ?? null,
    updatedAt: user.updated_at ?? null,
  };
}

async function findUserByEmail(email) {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin client is not configured.');
  }

  let page = 1;

  while (true) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: USERS_PAGE_SIZE,
    });

    if (error) {
      throw new Error(error.message);
    }

    const users = data?.users ?? [];
    const match = users.find(
      (user) => String(user.email ?? '').trim().toLowerCase() === email,
    );

    if (match) {
      return match;
    }

    const lastPage = Number(data?.lastPage ?? page);
    const nextPage = Number(data?.nextPage ?? page + 1);

    if (users.length === 0 || page >= lastPage) {
      break;
    }

    page = nextPage > page ? nextPage : page + 1;
  }

  return null;
}

export async function seedMasterAccount() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return createErrorResult(
      'Supabase service role credentials are required to seed the master account.',
    );
  }

  const config = getMasterAccountConfig();

  if (!config.ok) {
    return createErrorResult(config.error);
  }

  try {
    const existingUser = await findUserByEmail(config.email);
    const passwordFingerprint = await createPasswordFingerprint(
      config.email,
      config.password,
    );
    const metadata = buildRoleMetadata(existingUser, passwordFingerprint);

    if (!existingUser) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: config.email,
        password: config.password,
        ...metadata,
      });

      if (error || !data?.user) {
        return createErrorResult(
          error?.message ?? 'Unable to create the master account.',
        );
      }

      const seededUser = normalizeSeededUser(data.user);
      await upsertProfileFromAuthUser(data.user).catch(() => null);
      await logger.info('Master account created.', {
        email: seededUser.email,
        role: seededUser.role,
      });

      return createSuccessResult(seededUser, 'created', true);
    }

    const existingFingerprint =
      existingUser.app_metadata?.masterAccount?.passwordFingerprint ?? '';
    const needsPasswordUpdate = existingFingerprint !== passwordFingerprint;
    const needsRoleUpdate =
      existingUser.app_metadata?.role !== ROLES.SUPER_ADMIN ||
      existingUser.user_metadata?.role !== ROLES.SUPER_ADMIN;

    if (!needsPasswordUpdate && !needsRoleUpdate) {
      return createSuccessResult(
        normalizeSeededUser(existingUser),
        'unchanged',
        false,
      );
    }

    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      existingUser.id,
      {
        ...metadata,
        ...(needsPasswordUpdate ? { password: config.password } : {}),
      },
    );

    if (error) {
      return createErrorResult(
        error.message ?? 'Unable to update the master account.',
      );
    }

    const seededUser = normalizeSeededUser(data.user ?? existingUser);
    await upsertProfileFromAuthUser(data.user ?? existingUser).catch(() => null);
    await logger.info('Master account refreshed.', {
      email: seededUser.email,
      role: seededUser.role,
      passwordUpdated: needsPasswordUpdate,
    });

    return createSuccessResult(seededUser, 'updated', true);
  } catch (error) {
    await logger.error('Master account seeding failed.', {
      error: error?.message ?? 'Unexpected master account error.',
    });

    return createErrorResult(
      error?.message ?? 'Unexpected master account seeding failure.',
    );
  }
}

export default {
  seedMasterAccount,
};
