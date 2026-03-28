import { execSync } from 'node:child_process';
import { buildAppFromSpec } from '../intelligence/codeEngine.js';
import { buildFullApp } from '../execution/appTemplate.js';

let portBase = 6000;

const BLOCKED_PORTS = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 77, 79, 87,
  95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139,
  143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532, 540, 548,
  554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720, 1723, 2049, 3659,
  4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

function isPortAvailable(port) {
  try {
    execSync(`lsof -iTCP:${port} -sTCP:LISTEN -n -P`, {
      stdio: 'ignore',
    });
    return false;
  } catch {
    return true;
  }
}

function resolveSafePort(startPort) {
  let port = startPort;

  while (BLOCKED_PORTS.has(port) || !isPortAvailable(port)) {
    port += 1;
  }

  return port;
}

export async function buildMultipleApps(ideas) {
  const apps = [];

  for (const idea of ideas) {
    const app = await buildAppFromSpec(idea);
    apps.push(app);
  }

  return apps;
}

export async function buildSelectedApps(products) {
  const results = [];

  for (const product of products) {
    const spec = {
      name: product.name,
      features: product.features,
    };
    const built = buildFullApp(spec);
    const port = resolveSafePort(portBase);
    portBase = port + 1;

    built.server.listen(port, '127.0.0.1');

    results.push({
      name: product.name,
      url: `http://localhost:${port}`,
      frontend: built.frontend,
      app: built,
    });
  }

  return results;
}

export default {
  buildMultipleApps,
  buildSelectedApps,
};
