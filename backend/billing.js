import crypto from 'node:crypto';
import {
  getProfileByCustomerId,
  getProfileByUserId,
  updateProfileBilling,
} from './profileStore.js';
import {
  createServiceRoleSupabaseClient,
  isSupabaseAdminConfigured,
} from './supabaseClient.js';

const STRIPE_API_URL = 'https://api.stripe.com/v1';
const DEFAULT_SUPPORT_EMAIL = process.env.SUPPORT_EMAIL?.trim() || 'support@omniforge.local';

const BILLING_PLANS = Object.freeze([
  {
    id: 'free',
    name: 'Free',
    priceLabel: '$0',
    interval: 'month',
    description: 'Good for evaluation and light usage.',
    features: [
      'Basic builder access',
      'Limited build volume',
      'Single workspace owner',
    ],
    checkoutEnabled: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    priceLabel: process.env.STRIPE_PRO_PRICE_LABEL?.trim() || '$49',
    interval: 'month',
    description: 'For active operators shipping production builds.',
    features: [
      'Higher build volume',
      'Deployments, domains, and billing',
      'Priority access to new platform features',
    ],
    checkoutEnabled: true,
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    priceLabel: process.env.STRIPE_ENTERPRISE_PRICE_LABEL?.trim() || 'Custom',
    interval: 'custom',
    description: 'Custom pricing for internal teams and high-volume accounts.',
    features: [
      'Custom limits and onboarding',
      'Administrative controls',
      'Priority support and rollout planning',
    ],
    checkoutEnabled: false,
  },
]);

function getStripeConfig() {
  return {
    secretKey: process.env.STRIPE_SECRET?.trim() || process.env.STRIPE_SECRET_KEY?.trim() || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '',
    proPriceId: process.env.STRIPE_PRICE_PRO?.trim() ?? '',
    enterprisePriceId: process.env.STRIPE_PRICE_ENTERPRISE?.trim() ?? '',
    platformUrl: process.env.FRONTEND_URL?.trim() || process.env.PLATFORM_URL?.trim() || '',
  };
}

function getPlanById(planId) {
  return BILLING_PLANS.find((plan) => plan.id === planId) ?? null;
}

function getBillingClient() {
  return isSupabaseAdminConfigured ? createServiceRoleSupabaseClient() : null;
}

function getPriceIdForPlan(planId) {
  const config = getStripeConfig();

  if (planId === 'pro') {
    return config.proPriceId;
  }

  if (planId === 'enterprise') {
    return config.enterprisePriceId;
  }

  return '';
}

function createStripeHeaders(secretKey) {
  return {
    Authorization: `Bearer ${secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

async function stripeRequest(pathname, {
  method = 'GET',
  form = null,
} = {}) {
  const { secretKey } = getStripeConfig();

  if (!secretKey) {
    throw new Error('Stripe is not configured. Set STRIPE_SECRET or STRIPE_SECRET_KEY first.');
  }

  const response = await fetch(`${STRIPE_API_URL}${pathname}`, {
    method,
    headers: createStripeHeaders(secretKey),
    body: form ? form.toString() : undefined,
  });
  const rawBody = await response.text();
  let payload = {};

  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(
      payload?.error?.message ??
        `Stripe request failed with status ${response.status}.`,
    );
  }

  return payload;
}

function createSubscriptionSummary(profile) {
  return {
    plan: profile?.billingPlan ?? 'free',
    status: profile?.subscriptionStatus ?? 'inactive',
    stripeCustomerId: profile?.stripeCustomerId ?? null,
    stripeSubscriptionId: profile?.stripeSubscriptionId ?? null,
    currentPeriodEnd: profile?.currentPeriodEnd ?? null,
  };
}

function buildSuccessUrl(origin) {
  const config = getStripeConfig();
  const baseUrl = config.platformUrl || origin || 'http://localhost:5173';
  return `${baseUrl.replace(/\/+$/, '')}/dashboard?billing=success`;
}

function buildCancelUrl(origin) {
  const config = getStripeConfig();
  const baseUrl = config.platformUrl || origin || 'http://localhost:5173';
  return `${baseUrl.replace(/\/+$/, '')}/dashboard?billing=cancelled`;
}

function parseStripeTimestamp(signatureHeader) {
  const pairs = String(signatureHeader)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  const values = {};

  for (const pair of pairs) {
    const [key, value] = pair.split('=');
    if (key && value) {
      values[key] = value;
    }
  }

  return values;
}

function verifyStripeWebhook(rawBody, signatureHeader) {
  const { webhookSecret } = getStripeConfig();

  if (!webhookSecret) {
    throw new Error('Stripe webhook secret is not configured.');
  }

  const values = parseStripeTimestamp(signatureHeader);
  const timestamp = values.t;
  const signature = values.v1;

  if (!timestamp || !signature) {
    throw new Error('Invalid Stripe signature header.');
  }

  const expected = crypto
    .createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');

  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== signatureBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    throw new Error('Stripe webhook signature verification failed.');
  }

  return JSON.parse(rawBody);
}

function getPlanFeatures() {
  const stripeConfigured = Boolean(getStripeConfig().secretKey && getStripeConfig().proPriceId);

  return BILLING_PLANS.map((plan) => ({
    ...plan,
    checkoutEnabled:
      plan.id === 'pro'
        ? stripeConfigured
        : plan.checkoutEnabled,
    action:
      plan.id === 'enterprise'
        ? {
            type: 'contact',
            label: 'Contact Sales',
            href: `mailto:${DEFAULT_SUPPORT_EMAIL}?subject=${encodeURIComponent('OmniForge Enterprise')}`,
          }
        : plan.id === 'free'
          ? {
              type: 'current',
              label: 'Included',
            }
          : {
              type: stripeConfigured ? 'checkout' : 'disabled',
              label: stripeConfigured ? 'Upgrade to Pro' : 'Stripe Not Configured',
            },
  }));
}

export async function getBillingOverview(user) {
  const profile = user?.id ? await getProfileByUserId(user.id) : null;

  return {
    configured: Boolean(getStripeConfig().secretKey && getStripeConfig().proPriceId),
    supportEmail: DEFAULT_SUPPORT_EMAIL,
    plans: getPlanFeatures(),
    subscription: createSubscriptionSummary(profile),
  };
}

export async function createCheckoutSession({
  user,
  planId,
  origin = '',
} = {}) {
  if (!user || typeof user?.id !== 'string') {
    throw new Error('An authenticated user is required to create a billing checkout session.');
  }

  const plan = getPlanById(planId);

  if (!plan) {
    throw new Error('Unknown billing plan.');
  }

  if (plan.id === 'free') {
    return {
      status: 'noop',
      plan: plan.id,
      message: 'The Free plan does not require checkout.',
    };
  }

  if (plan.id === 'enterprise') {
    return {
      status: 'contact',
      plan: plan.id,
      url: `mailto:${DEFAULT_SUPPORT_EMAIL}?subject=${encodeURIComponent('OmniForge Enterprise')}`,
    };
  }

  const priceId = getPriceIdForPlan(plan.id);

  if (!priceId) {
    throw new Error(`Stripe price id is missing for the ${plan.name} plan.`);
  }

  const profile = await getProfileByUserId(user.id);
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('success_url', buildSuccessUrl(origin));
  form.set('cancel_url', buildCancelUrl(origin));
  form.set('line_items[0][price]', priceId);
  form.set('line_items[0][quantity]', '1');
  form.set('client_reference_id', user.id);
  form.set('metadata[user_id]', user.id);
  form.set('metadata[plan_id]', plan.id);
  form.set('metadata[email]', user.email ?? '');

  if (profile?.stripeCustomerId) {
    form.set('customer', profile.stripeCustomerId);
  } else if (user.email) {
    form.set('customer_email', user.email);
  }

  const payload = await stripeRequest('/checkout/sessions', {
    method: 'POST',
    form,
  });

  return {
    status: 'created',
    plan: plan.id,
    sessionId: payload.id,
    url: payload.url,
  };
}

async function applyCheckoutCompletion(sessionObject) {
  const userId =
    sessionObject?.metadata?.user_id ??
    sessionObject?.client_reference_id ??
    '';

  if (!userId) {
    return;
  }

  await updateProfileBilling(userId, {
    billingPlan: sessionObject?.metadata?.plan_id ?? 'pro',
    subscriptionStatus: sessionObject?.status === 'complete' ? 'active' : 'pending',
    stripeCustomerId: sessionObject?.customer ?? null,
    stripeSubscriptionId: sessionObject?.subscription ?? null,
  });
}

async function applySubscriptionUpdate(subscriptionObject, status) {
  const customerId = subscriptionObject?.customer ?? '';

  if (!customerId) {
    return;
  }

  const profile = await getProfileByCustomerId(customerId);

  if (!profile) {
    return;
  }

  await updateProfileBilling(profile.userId, {
    billingPlan: status === 'canceled' ? 'free' : profile.billingPlan,
    subscriptionStatus: status ?? subscriptionObject?.status ?? 'active',
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionObject?.id ?? null,
    stripePriceId:
      subscriptionObject?.items?.data?.[0]?.price?.id ?? null,
    currentPeriodEnd: subscriptionObject?.current_period_end
      ? new Date(subscriptionObject.current_period_end * 1000).toISOString()
      : null,
  });
}

async function recordBillingEvent(event) {
  const client = getBillingClient();

  if (!client || !event?.id) {
    return;
  }

  const userId =
    event?.data?.object?.metadata?.user_id ??
    event?.data?.object?.client_reference_id ??
    null;

  const { error } = await client
    .from('billing_events')
    .upsert({
      stripe_event_id: event.id,
      event_type: event.type,
      user_id: userId,
      payload: event,
    }, {
      onConflict: 'stripe_event_id',
    });

  if (error) {
    throw new Error(error.message);
  }
}

export async function handleStripeWebhook(rawBody, signatureHeader) {
  const event = verifyStripeWebhook(rawBody, signatureHeader);
  await recordBillingEvent(event).catch(() => null);

  switch (event.type) {
    case 'checkout.session.completed':
      await applyCheckoutCompletion(event.data?.object ?? {});
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await applySubscriptionUpdate(event.data?.object ?? {}, 'active');
      break;
    case 'customer.subscription.deleted':
      await applySubscriptionUpdate(event.data?.object ?? {}, 'canceled');
      break;
    default:
      break;
  }

  return {
    ok: true,
    received: true,
    eventType: event.type,
  };
}

export default {
  getBillingOverview,
  createCheckoutSession,
  handleStripeWebhook,
};
