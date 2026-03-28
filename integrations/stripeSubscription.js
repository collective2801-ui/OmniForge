import Stripe from 'stripe';

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

export async function createSubscription(priceId) {
  return getStripeClient().checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url:
      process.env.BILLING_SUCCESS_URL?.trim() || 'https://yourdomain.com/success',
    cancel_url:
      process.env.BILLING_CANCEL_URL?.trim() || 'https://yourdomain.com/cancel',
  });
}

export default {
  createSubscription,
};
