import express from 'express';
import { execSync } from 'node:child_process';

let currentPort = 5000;

function resolveAvailablePort(startPort) {
  let port = startPort;

  while (true) {
    try {
      execSync(`lsof -iTCP:${port} -sTCP:LISTEN -n -P`, {
        stdio: 'ignore',
      });
      port += 1;
    } catch {
      return port;
    }
  }
}

export function startPreview(appHTML) {
  const server = express();
  const host = '127.0.0.1';
  const port = resolveAvailablePort(currentPort);
  currentPort = port + 1;
  const publicUrl = `http://localhost:${port}`;

  server.get('/', (req, res) => {
    res.send(appHTML);
  });

  server.listen(port, host);

  return publicUrl;
}

export default {
  startPreview,
};
