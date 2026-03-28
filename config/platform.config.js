import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDirectory = path.resolve(__dirname, '..');

export const platformName = 'OmniForge';
export const workspaceRoot = path.join(rootDirectory, 'workspace');
export const defaultAppDirectory = path.join(rootDirectory, 'apps');
export const defaultTemplateDirectory = path.join(rootDirectory, 'templates');
export const registryFileLocation = path.join(
  rootDirectory,
  'runtime',
  'project-registry.json',
);
export const memoryFileLocation = path.join(
  rootDirectory,
  'runtime',
  'context-memory.json',
);
export const logFileLocation = path.join(rootDirectory, 'logs', 'system.log');

const platformConfig = Object.freeze({
  platformName,
  rootDirectory,
  workspaceRoot,
  defaultAppDirectory,
  defaultTemplateDirectory,
  registryFileLocation,
  memoryFileLocation,
  logFileLocation,
});

export default platformConfig;
