import express from 'express';
import { fileURLToPath } from 'node:url';
import { runOmniForge } from './index.js';
import { validateBuildRequest } from './shared/index.js';

export function createBuildServer() {
  const app = express();
  app.use(express.json());

  app.post('/build', async (req, res) => {
    try {
      const validation = validateBuildRequest(req.body ?? {});

      if (!validation.ok) {
        res.status(400).json({
          error: validation.error,
        });
        return;
      }

      const { url, selected } = validation.value;
      const result = await runOmniForge(url, selected);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: error?.message ?? 'Unexpected OmniForge build failure.',
      });
    }
  });

  return app;
}

export function startBuildServer(port = 3000) {
  const app = createBuildServer();

  return app.listen(port, () => {
    console.log(`OmniForge running on http://localhost:${port}`);
  });
}

const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  startBuildServer();
}

export default {
  createBuildServer,
  startBuildServer,
};
