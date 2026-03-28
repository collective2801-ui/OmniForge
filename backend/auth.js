import { createClient } from '@supabase/supabase-js';
import { seedMasterAccount } from './masterAccount.js';
import {
  getProfileByUserId,
  mergeUserWithProfile,
  upsertProfileFromAuthUser,
} from './profileStore.js';
import { ROLES, normalizeRole } from './roles.js';
import {
  isSupabaseConfigured,
  supabase,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from './supabaseClient.js';

function createErrorResponse(code, message) {
  return {
    ok: false,
    user: null,
    session: null,
    error: {
      code,
      message,
    },
  };
}

function createSuccessResponse({
  user = null,
  session = null,
  requiresEmailConfirmation = false,
}) {
  return {
    ok: true,
    user,
    session,
    requiresEmailConfirmation,
    error: null,
  };
}

function validateCredentials(email, password) {
  if (typeof email !== 'string' || email.trim().length === 0) {
    return createErrorResponse('invalid_email', 'Email is required.');
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim().toLowerCase())) {
    return createErrorResponse('invalid_email', 'Enter a valid email address.');
  }

  if (typeof password !== 'string' || password.length < 8) {
    return createErrorResponse(
      'invalid_password',
      'Password must be at least 8 characters long.',
    );
  }

  return null;
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function resolveUserRole(user) {
  return normalizeRole(
    user?.app_metadata?.role ??
      user?.user_metadata?.role ??
      user?.role,
  );
}

function normalizeUser(user) {
  if (!user) {
    return null;
  }

  return mergeUserWithProfile(user, null);
}

async function normalizeUserWithProfile(user) {
  if (!user) {
    return null;
  }

  let profile = null;

  try {
    profile = await getProfileByUserId(user.id);
  } catch {
    profile = null;
  }

  return mergeUserWithProfile(user, profile);
}

async function normalizeSession(session, user = session?.user ?? null) {
  if (!session) {
    return null;
  }
  const normalizedUser = await normalizeUserWithProfile(user);

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
    role: normalizedUser?.role ?? resolveUserRole(user),
    access: normalizedUser?.access ?? mergeUserWithProfile(user, null)?.access,
    user: normalizedUser,
  };
}

function createSessionClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

async function maybeSeedMasterAccount(email) {
  const masterEmail = process.env.MASTER_EMAIL?.trim().toLowerCase() ?? '';

  if (!masterEmail || String(email).trim().toLowerCase() !== masterEmail) {
    return;
  }

  await seedMasterAccount();
}

export async function signUp(email, password) {
  if (!isSupabaseConfigured || !supabase) {
    return createErrorResponse(
      'configuration_error',
      'Supabase environment variables are not configured.',
    );
  }

  const validationError = validateCredentials(email, password);

  if (validationError) {
    return validationError;
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email: normalizeEmail(email),
      password,
      options: {
        data: {
          role: ROLES.USER,
        },
      },
    });

    if (error) {
      return createErrorResponse('signup_failed', error.message);
    }

    if (data.user) {
      await upsertProfileFromAuthUser(data.user).catch(() => null);
    }

    const normalizedUser = await normalizeUserWithProfile(data.user);

    return createSuccessResponse({
      user: normalizedUser,
      session: await normalizeSession(data.session, data.user),
      requiresEmailConfirmation: Boolean(data.user && !data.session),
    });
  } catch (error) {
    return createErrorResponse(
      'signup_failed',
      error?.message ?? 'Unexpected signup failure.',
    );
  }
}

export async function signIn(email, password) {
  if (!isSupabaseConfigured || !supabase) {
    return createErrorResponse(
      'configuration_error',
      'Supabase environment variables are not configured.',
    );
  }

    const validationError = validateCredentials(email, password);

  if (validationError) {
    return validationError;
  }

    try {
      const normalizedEmail = normalizeEmail(email);

      await maybeSeedMasterAccount(normalizedEmail);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

    if (error) {
      return createErrorResponse('signin_failed', error.message);
    }

    if (data.user) {
      await upsertProfileFromAuthUser(data.user).catch(() => null);
    }

    const normalizedUser = await normalizeUserWithProfile(data.user);

    return createSuccessResponse({
      user: normalizedUser,
      session: await normalizeSession(data.session, data.user),
    });
  } catch (error) {
    return createErrorResponse(
      'signin_failed',
      error?.message ?? 'Unexpected signin failure.',
    );
  }
}

export async function signOut(session = {}) {
  if (!isSupabaseConfigured) {
    return createErrorResponse(
      'configuration_error',
      'Supabase environment variables are not configured.',
    );
  }

  if (
    typeof session?.accessToken !== 'string' ||
    session.accessToken.trim().length === 0 ||
    typeof session?.refreshToken !== 'string' ||
    session.refreshToken.trim().length === 0
  ) {
    return createSuccessResponse({});
  }

  try {
    const sessionClient = createSessionClient();
    const { error: setSessionError } = await sessionClient.auth.setSession({
      access_token: session.accessToken.trim(),
      refresh_token: session.refreshToken.trim(),
    });

    if (setSessionError) {
      return createErrorResponse('signout_failed', setSessionError.message);
    }

    const { error } = await sessionClient.auth.signOut();

    if (error) {
      return createErrorResponse('signout_failed', error.message);
    }

    return createSuccessResponse({});
  } catch (error) {
    return createErrorResponse(
      'signout_failed',
      error?.message ?? 'Unexpected signout failure.',
    );
  }
}

export async function getCurrentUser(accessToken = '') {
  if (!isSupabaseConfigured || !supabase) {
    return createErrorResponse(
      'configuration_error',
      'Supabase environment variables are not configured.',
    );
  }

  try {
    const { data, error } =
      typeof accessToken === 'string' && accessToken.trim().length > 0
        ? await supabase.auth.getUser(accessToken.trim())
        : await supabase.auth.getUser();

    if (error) {
      return createErrorResponse('user_lookup_failed', error.message);
    }

    return createSuccessResponse({
      user: await normalizeUserWithProfile(data.user),
      session: null,
    });
  } catch (error) {
    return createErrorResponse(
      'user_lookup_failed',
      error?.message ?? 'Unexpected user lookup failure.',
    );
  }
}

export default {
  signUp,
  signIn,
  signOut,
  getCurrentUser,
};
