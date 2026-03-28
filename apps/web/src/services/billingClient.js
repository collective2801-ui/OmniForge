import { apiRequest } from './apiClient.js';

function normalizeFailure(message, code = 'request_failed') {
  return {
    ok: false,
    error: {
      code,
      message,
    },
  };
}

async function request(path, options = {}) {
  try {
    const payload = await apiRequest(path, options);
    return {
      ok: true,
      ...payload,
      error: null,
    };
  } catch (error) {
    return normalizeFailure(
      error?.message ?? 'Billing request failed.',
    );
  }
}

export async function getBillingOverview() {
  return request('/api/billing/config');
}

export async function createBillingCheckout(planId) {
  return request('/api/billing/checkout', {
    method: 'POST',
    body: {
      planId,
    },
  });
}

export async function getSubscriptionStatus() {
  return request('/api/billing/subscription');
}

export default {
  getBillingOverview,
  createBillingCheckout,
  getSubscriptionStatus,
};
