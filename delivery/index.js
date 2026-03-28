import fs from 'node:fs';
import path from 'node:path';
import domainService from '../domain/domainService.js';
import { autoDeploy, deployBackend, deployFrontend } from '../deploy/index.js';
import infraManager from '../deployment/infraManager.js';
import {
  buildMobileApp,
  buildExpoApp,
} from '../mobile/mobileBuilder.js';
import {
  prepareStore,
  prepareStoreSubmission,
} from '../mobile/storePublisher.js';
import { generateAppMetadata } from '../mobile/metadataGenerator.js';

export function deliverApp(app) {
  return {
    access: app?.url || 'http://localhost:5000',
    instructions: 'Open in browser and use immediately',
    status: 'ready',
  };
}

export function saveApp(name, app) {
  const dir = `./output/${String(name).replace(/\s/g, '_')}`;
  const absoluteDir = path.join(process.cwd(), dir.replace(/^\.\//, ''));

  if (!fs.existsSync(absoluteDir)) {
    fs.mkdirSync(absoluteDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(absoluteDir, 'index.html'),
    String(app?.frontend ?? ''),
  );

  return dir;
}

export {
  autoDeploy,
  deployFrontend,
  deployBackend,
  domainService,
  infraManager,
  buildMobileApp,
  buildExpoApp,
  prepareStore,
  prepareStoreSubmission,
  generateAppMetadata,
};

export default {
  autoDeploy,
  deployFrontend,
  deployBackend,
  deliverApp,
  saveApp,
  domainService,
  infraManager,
  buildMobileApp,
  buildExpoApp,
  prepareStore,
  prepareStoreSubmission,
  generateAppMetadata,
};
