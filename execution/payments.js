import Stripe from 'stripe';
import {
  createCheckoutSession as createManagedCheckoutSession,
  getBillingOverview,
  handleStripeWebhook,
} from '../backend/billing.js';
import { createSubscription } from '../integrations/stripeSubscription.js';

let stripeClient = null;

function getStripeClient() {
  if (stripeClient) {
    return stripeClient;
  }

  const secretKey =
    process.env.STRIPE_SECRET?.trim() ||
    process.env.STRIPE_SECRET_KEY?.trim() ||
    '';

  if (!secretKey) {
    throw new Error('Stripe secret is not configured. Set STRIPE_SECRET or STRIPE_SECRET_KEY.');
  }

  stripeClient = new Stripe(secretKey);
  return stripeClient;
}

export {
  createManagedCheckoutSession,
  getBillingOverview,
  handleStripeWebhook,
  createSubscription,
};

export async function createCheckoutSession(priceId) {
  return getStripeClient().checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url:
      process.env.BILLING_SUCCESS_URL?.trim() || 'http://localhost:3000/success',
    cancel_url:
      process.env.BILLING_CANCEL_URL?.trim() || 'http://localhost:3000/cancel',
  });
}

export async function startCheckout({
  user,
  planId = 'pro',
  origin = '',
} = {}) {
  return createManagedCheckoutSession({
    user,
    planId,
    origin,
  });
}

export default {
  getBillingOverview,
  createCheckoutSession,
  createManagedCheckoutSession,
  startCheckout,
  handleStripeWebhook,
  createSubscription,
};
