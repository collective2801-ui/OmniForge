import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMetrics } from '../business/revenueTracker.js';

export const app = express();

app.get('/metrics', async (req, res) => {
  res.json(await getMetrics());
});

export function startDashboardServer(port = 4000) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`Dashboard running on port ${port}`);
      resolve(server);
    });

    server.on('error', reject);
  });
}

export default {
  app,
  startDashboardServer,
};

const currentFilePath = fileURLToPath(import.meta.url);
const executedFilePath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (currentFilePath === executedFilePath) {
  await startDashboardServer();
}
