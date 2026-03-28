import path from 'node:path';
import fs from 'fs-extra';

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function resolveTargetPath(targetPath) {
  assertNonEmptyString(targetPath, 'Path');
  return path.resolve(targetPath);
}

function createTemporaryPath(targetPath) {
  const directory = path.dirname(targetPath);
  const baseName = path.basename(targetPath);
  return path.join(
    directory,
    `.${baseName}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`,
  );
}

async function commitTemporaryFile(tempPath, targetPath) {
  try {
    await fs.move(tempPath, targetPath, { overwrite: true });
  } finally {
    if (await fs.pathExists(tempPath)) {
      await fs.remove(tempPath);
    }
  }
}

export async function ensureDirectory(directoryPath) {
  const resolvedDirectoryPath = resolveTargetPath(directoryPath);
  await fs.ensureDir(resolvedDirectoryPath);
  return resolvedDirectoryPath;
}

export async function fileExists(filePath) {
  const resolvedFilePath = resolveTargetPath(filePath);
  return fs.pathExists(resolvedFilePath);
}

export async function readFileSafe(
  filePath,
  { encoding = 'utf8', defaultValue = null, throwIfMissing = false } = {},
) {
  const resolvedFilePath = resolveTargetPath(filePath);
  const exists = await fs.pathExists(resolvedFilePath);

  if (!exists) {
    if (throwIfMissing) {
      throw new Error(`File does not exist: ${resolvedFilePath}`);
    }

    return defaultValue;
  }

  return fs.readFile(resolvedFilePath, encoding);
}

export async function writeFileSafe(
  filePath,
  contents,
  { encoding = 'utf8' } = {},
) {
  const resolvedFilePath = resolveTargetPath(filePath);

  if (typeof contents !== 'string' && !Buffer.isBuffer(contents)) {
    throw new TypeError('File contents must be a string or Buffer.');
  }

  await ensureDirectory(path.dirname(resolvedFilePath));

  const temporaryPath = createTemporaryPath(resolvedFilePath);
  await fs.outputFile(temporaryPath, contents, typeof contents === 'string' ? { encoding } : undefined);
  await commitTemporaryFile(temporaryPath, resolvedFilePath);

  return resolvedFilePath;
}

export async function updateFileSafe(
  filePath,
  updater,
  {
    encoding = 'utf8',
    defaultValue = '',
    throwIfMissing = false,
  } = {},
) {
  if (typeof updater !== 'function' && typeof updater !== 'string') {
    throw new TypeError('Updater must be a function or a string.');
  }

  const currentContents = await readFileSafe(filePath, {
    encoding,
    defaultValue,
    throwIfMissing,
  });

  const nextContents =
    typeof updater === 'function' ? await updater(currentContents) : updater;

  if (typeof nextContents !== 'string' && !Buffer.isBuffer(nextContents)) {
    throw new TypeError('Updated file contents must resolve to a string or Buffer.');
  }

  return writeFileSafe(filePath, nextContents, { encoding });
}

export async function writeJsonSafe(
  filePath,
  data,
  { spaces = 2 } = {},
) {
  const resolvedFilePath = resolveTargetPath(filePath);
  await ensureDirectory(path.dirname(resolvedFilePath));

  const temporaryPath = createTemporaryPath(resolvedFilePath);
  await fs.writeJson(temporaryPath, data, { spaces });
  await commitTemporaryFile(temporaryPath, resolvedFilePath);

  return resolvedFilePath;
}

export async function readJsonSafe(
  filePath,
  { defaultValue = null, throwIfMissing = false } = {},
) {
  const resolvedFilePath = resolveTargetPath(filePath);
  const exists = await fs.pathExists(resolvedFilePath);

  if (!exists) {
    if (throwIfMissing) {
      throw new Error(`JSON file does not exist: ${resolvedFilePath}`);
    }

    return defaultValue;
  }

  return fs.readJson(resolvedFilePath);
}

const fileSystem = {
  ensureDirectory,
  fileExists,
  readFileSafe,
  writeFileSafe,
  updateFileSafe,
  writeJsonSafe,
  readJsonSafe,
};

export default fileSystem;
