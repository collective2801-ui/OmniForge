export function buildCheckoutSessionTemplate() {
  return `import Stripe from 'stripe';

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(\`Missing required environment variable: \${name}\`);
  }

  return value;
}

export async function createCheckoutSession({
  priceId = '',
  lineItems = [],
  customerEmail = '',
  successUrl = process.env.BILLING_SUCCESS_URL,
  cancelUrl = process.env.BILLING_CANCEL_URL,
  mode = 'subscription',
  metadata = {},
} = {}) {
  const secretKey = requireEnv('STRIPE_SECRET_KEY');
  const stripe = new Stripe(secretKey);

  if (typeof successUrl !== 'string' || successUrl.trim().length === 0) {
    throw new TypeError('successUrl is required.');
  }

  if (typeof cancelUrl !== 'string' || cancelUrl.trim().length === 0) {
    throw new TypeError('cancelUrl is required.');
  }

  const normalizedLineItems = Array.isArray(lineItems) && lineItems.length > 0
    ? lineItems.map((item, index) => {
        if (typeof item?.priceId !== 'string' || item.priceId.trim().length === 0) {
          throw new TypeError(\`lineItems[\${index}] is missing priceId.\`);
        }

        return {
          price: item.priceId.trim(),
          quantity: Number.isInteger(item.quantity) && item.quantity > 0 ? item.quantity : 1,
        };
      })
    : (() => {
        if (typeof priceId !== 'string' || priceId.trim().length === 0) {
          throw new TypeError('priceId is required when lineItems are not supplied.');
        }

        return [{
          price: priceId.trim(),
          quantity: 1,
        }];
      })();

  const payload = await stripe.checkout.sessions.create({
    payment_method_types: ['card'],
    line_items: normalizedLineItems,
    mode,
    success_url: successUrl.trim(),
    cancel_url: cancelUrl.trim(),
    ...(typeof customerEmail === 'string' && customerEmail.trim().length > 0
      ? {
          customer_email: customerEmail.trim(),
        }
      : {}),
    metadata: Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null),
    ),
  });

  return {
    id: payload.id,
    url: payload.url,
    raw: payload,
  };
}

export async function postCheckoutSessionHandler(request) {
  const payload = await request.json();
  const session = await createCheckoutSession(payload);
  return Response.json({
    checkoutUrl: session.url,
    sessionId: session.id,
  });
}

export default postCheckoutSessionHandler;
`;
}

export function buildWebhookHandlerTemplate() {
  return `import crypto from 'node:crypto';

const DEFAULT_TOLERANCE_SECONDS = 300;

function requireEnv(name) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(\`Missing required environment variable: \${name}\`);
  }

  return value;
}

function timingSafeCompare(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseSignatureHeader(header) {
  return String(header)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((signatureParts, entry) => {
      const [key, value] = entry.split('=');

      if (key && value) {
        signatureParts[key] = value;
      }

      return signatureParts;
    }, {});
}

export function verifyStripeWebhookSignature(payload, signatureHeader, {
  secret = requireEnv('STRIPE_WEBHOOK_SECRET'),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
} = {}) {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new TypeError('Webhook payload must be a non-empty string.');
  }

  const signatureParts = parseSignatureHeader(signatureHeader);
  const timestamp = Number(signatureParts.t);
  const receivedSignature = signatureParts.v1;

  if (!timestamp || !receivedSignature) {
    throw new Error('Stripe signature header is missing required parts.');
  }

  const ageSeconds = Math.abs(Date.now() / 1000 - timestamp);

  if (ageSeconds > toleranceSeconds) {
    throw new Error('Stripe webhook signature timestamp is outside the allowed tolerance window.');
  }

  const signedPayload = \`\${timestamp}.\${payload}\`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  if (!timingSafeCompare(expectedSignature, receivedSignature)) {
    throw new Error('Stripe webhook signature verification failed.');
  }

  return JSON.parse(payload);
}

export async function handleStripeWebhook(request, handlers = {}) {
  const payload = await request.text();
  const signature = request.headers.get('stripe-signature') ?? '';
  const event = verifyStripeWebhookSignature(payload, signature);
  const handler = handlers[event.type];

  if (typeof handler === 'function') {
    await handler(event);
  }

  return Response.json({
    received: true,
    type: event.type,
  });
}

export default handleStripeWebhook;
`;
}

export function buildClientIntegrationTemplate() {
  return `export async function redirectToCheckout({
  apiUrl = '/api/billing/checkout',
  ...payload
} = {}) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json();

  if (!response.ok) {
    throw new Error(result?.error ?? 'Unable to start checkout.');
  }

  if (typeof result?.checkoutUrl !== 'string' || result.checkoutUrl.length === 0) {
    throw new Error('Checkout URL was not returned by the billing endpoint.');
  }

  window.location.assign(result.checkoutUrl);
  return result;
}

export default redirectToCheckout;
`;
}

export default {
  buildCheckoutSessionTemplate,
  buildWebhookHandlerTemplate,
  buildClientIntegrationTemplate,
};
