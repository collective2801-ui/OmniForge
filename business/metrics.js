import { listPlatformEvents, recordPlatformEvent } from '../backend/persistenceStore.js';

const metrics = await listPlatformEvents({
  eventType: 'revenue.tracked',
  limit: 500,
  ascending: true,
})
  .then((events) =>
    events.map((event) => ({
      app: event.payload?.app ?? '',
      amount: Number(event.payload?.amount ?? 0),
      date: Number(event.payload?.date ?? Date.now()),
    })),
  )
  .catch(() => []);

export async function trackRevenue(app, amount) {
  const metric = {
    app,
    amount: Number(amount ?? 0),
    date: Date.now(),
  };

  metrics.push(metric);
  await recordPlatformEvent({
    eventType: 'revenue.tracked',
    payload: metric,
  }).catch(() => null);

  return metric;
}

export async function getMetrics() {
  return [...metrics].sort((left, right) => right.date - left.date);
}

export default {
  trackRevenue,
  getMetrics,
};
