import path from 'node:path';
import {
  readFileSafe,
  writeFileSafe,
} from '../../engine/fileSystem.js';

function assertProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new TypeError('Project path is required to generate .env.example.');
  }
}

function normalizeEntries(entries = []) {
  const seenKeys = new Set();

  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      key: typeof entry.key === 'string' ? entry.key.trim() : '',
      service: typeof entry.service === 'string' ? entry.service.trim() : 'general',
      provider: typeof entry.provider === 'string' ? entry.provider.trim() : 'integration',
      description: typeof entry.description === 'string' ? entry.description.trim() : '',
      required: entry.required !== false,
      defaultValue: typeof entry.defaultValue === 'string' ? entry.defaultValue : '',
    }))
    .filter((entry) => {
      if (!entry.key || seenKeys.has(entry.key)) {
        return false;
      }

      seenKeys.add(entry.key);
      return true;
    });
}

function parseExistingKeys(contents) {
  return new Set(
    String(contents)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => line.slice(0, line.indexOf('='))),
  );
}

function groupEntriesByService(entries) {
  return entries.reduce((groups, entry) => {
    const groupKey = `${entry.service}:${entry.provider}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        service: entry.service,
        provider: entry.provider,
        entries: [],
      });
    }

    groups.get(groupKey).entries.push(entry);
    return groups;
  }, new Map());
}

export function buildEnvExample(existingContents, entries = []) {
  const normalizedEntries = normalizeEntries(entries);
  const existingKeys = parseExistingKeys(existingContents);
  const nextEntries = normalizedEntries.filter((entry) => !existingKeys.has(entry.key));

  if (nextEntries.length === 0) {
    return String(existingContents || '');
  }

  const groups = [...groupEntriesByService(nextEntries).values()];
  const sections = [];

  if (String(existingContents || '').trim().length > 0) {
    sections.push(String(existingContents).replace(/\s+$/g, ''));
  }

  sections.push('# OmniForge API automation');
  sections.push('# Add real secrets locally and keep privileged values out of client code.');

  for (const group of groups) {
    sections.push('');
    sections.push(`# ${group.service} / ${group.provider}`);

    for (const entry of group.entries) {
      if (entry.description) {
        sections.push(`# ${entry.description}${entry.required ? '' : ' (Optional)'}`);
      }

      sections.push(`${entry.key}=${entry.defaultValue}`);
    }
  }

  return `${sections.join('\n')}\n`;
}

export async function generateEnvExample(projectPath, entries = []) {
  assertProjectPath(projectPath);

  const envFilePath = path.join(projectPath, '.env.example');
  const existingContents = await readFileSafe(envFilePath, {
    defaultValue: '',
  });
  const nextContents = buildEnvExample(existingContents, entries);

  await writeFileSafe(envFilePath, nextContents);

  return {
    path: '.env.example',
    absolutePath: envFilePath,
    envKeys: normalizeEntries(entries).map((entry) => entry.key),
  };
}

export default {
  buildEnvExample,
  generateEnvExample,
};
