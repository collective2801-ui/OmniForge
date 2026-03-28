const metrics = [];

export function trackRevenue(app, amount) {
  metrics.push({
    app,
    amount,
    date: Date.now(),
  });
}

export function getMetrics() {
  return metrics;
}

export default {
  trackRevenue,
  getMetrics,
};
