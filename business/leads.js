import { listPlatformEvents, recordPlatformEvent } from '../backend/persistenceStore.js';

const leads = await listPlatformEvents({
  eventType: 'lead.captured',
  limit: 500,
  ascending: true,
})
  .then((events) =>
    events.map((event) => ({
      email: event.payload?.email ?? '',
      date: event.payload?.date ?? Date.now(),
      source: event.payload?.source ?? 'omniforge',
    })),
  )
  .catch(() => []);

export async function captureLead(email, metadata = {}) {
  const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!normalizedEmail) {
    throw new Error('Lead email is required.');
  }

  const lead = {
    email: normalizedEmail,
    date: Date.now(),
    source:
      typeof metadata.source === 'string' && metadata.source.trim().length > 0
        ? metadata.source.trim()
        : 'omniforge',
  };

  leads.push(lead);
  await recordPlatformEvent({
    eventType: 'lead.captured',
    payload: lead,
  }).catch(() => null);

  return lead;
}

export async function getLeads() {
  return [...leads].sort((left, right) => right.date - left.date);
}

export default {
  captureLead,
  getLeads,
};
