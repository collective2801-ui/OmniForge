import { getAccessProfile } from './accessControl.js';
import { normalizeRole } from './roles.js';
import {
  createServiceRoleSupabaseClient,
  isSupabaseAdminConfigured,
} from './supabaseClient.js';

function getProfileClient() {
  return isSupabaseAdminConfigured ? createServiceRoleSupabaseClient() : null;
}

function normalizeProfileRow(profile) {
  if (!profile) {
    return null;
  }

  const role = normalizeRole(profile.role);
  const access = getAccessProfile({ role });

  return {
    userId: profile.user_id,
    email: profile.email ?? '',
    role,
    access,
    billingPlan: profile.billing_plan ?? 'free',
    subscriptionStatus: profile.subscription_status ?? 'inactive',
    stripeCustomerId: profile.stripe_customer_id ?? null,
    stripeSubscriptionId: profile.stripe_subscription_id ?? null,
    stripePriceId: profile.stripe_price_id ?? null,
    currentPeriodEnd: profile.current_period_end ?? null,
    createdAt: profile.created_at ?? null,
    updatedAt: profile.updated_at ?? null,
  };
}

function getUserRole(user) {
  return normalizeRole(
    user?.app_metadata?.role ??
      user?.user_metadata?.role ??
      user?.role,
  );
}

export async function getProfileByUserId(userId) {
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    return null;
  }

  const client = getProfileClient();

  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('user_id', userId.trim())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeProfileRow(data);
}

export async function getProfileByCustomerId(customerId) {
  if (typeof customerId !== 'string' || customerId.trim().length === 0) {
    return null;
  }

  const client = getProfileClient();

  if (!client) {
    return null;
  }

  const { data, error } = await client
    .from('profiles')
    .select('*')
    .eq('stripe_customer_id', customerId.trim())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeProfileRow(data);
}

export async function upsertProfileFromAuthUser(user) {
  if (!user || typeof user !== 'object' || typeof user.id !== 'string') {
    return null;
  }

  const client = getProfileClient();

  if (!client) {
    return null;
  }

  const payload = {
    user_id: user.id,
    email: user.email ?? '',
    role: getUserRole(user),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('profiles')
    .upsert(payload, {
      onConflict: 'user_id',
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeProfileRow(data);
}

export async function updateProfileBilling(userId, updates = {}) {
  if (typeof userId !== 'string' || userId.trim().length === 0) {
    throw new TypeError('User id is required to update billing profile data.');
  }

  const client = getProfileClient();

  if (!client) {
    throw new Error('Supabase service role credentials are required for billing updates.');
  }

  const existingProfile = await getProfileByUserId(userId.trim());
  const payload = {
    user_id: userId.trim(),
    email: existingProfile?.email ?? `billing-${userId.trim()}@local.invalid`,
    role: existingProfile?.role ?? 'user',
    updated_at: new Date().toISOString(),
  };

  if (typeof updates.billingPlan === 'string' && updates.billingPlan.trim().length > 0) {
    payload.billing_plan = updates.billingPlan.trim();
  }

  if (
    typeof updates.subscriptionStatus === 'string' &&
    updates.subscriptionStatus.trim().length > 0
  ) {
    payload.subscription_status = updates.subscriptionStatus.trim();
  }

  if (updates.stripeCustomerId !== undefined) {
    payload.stripe_customer_id = updates.stripeCustomerId || null;
  }

  if (updates.stripeSubscriptionId !== undefined) {
    payload.stripe_subscription_id = updates.stripeSubscriptionId || null;
  }

  if (updates.stripePriceId !== undefined) {
    payload.stripe_price_id = updates.stripePriceId || null;
  }

  if (updates.currentPeriodEnd !== undefined) {
    payload.current_period_end = updates.currentPeriodEnd || null;
  }

  const { data, error } = await client
    .from('profiles')
    .upsert(payload, {
      onConflict: 'user_id',
    })
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return normalizeProfileRow(data);
}

export function mergeUserWithProfile(user, profile) {
  if (!user) {
    return null;
  }

  const role = profile?.role ?? getUserRole(user);
  const access = getAccessProfile({ role });

  return {
    id: user.id,
    email: profile?.email ?? user.email ?? '',
    createdAt: user.created_at ?? user.createdAt ?? null,
    updatedAt: user.updated_at ?? user.updatedAt ?? null,
    role,
    access,
    billingPlan: profile?.billingPlan ?? 'free',
    subscriptionStatus: profile?.subscriptionStatus ?? 'inactive',
    stripeCustomerId: profile?.stripeCustomerId ?? null,
    stripeSubscriptionId: profile?.stripeSubscriptionId ?? null,
  };
}

export default {
  getProfileByUserId,
  getProfileByCustomerId,
  upsertProfileFromAuthUser,
  updateProfileBilling,
  mergeUserWithProfile,
};
