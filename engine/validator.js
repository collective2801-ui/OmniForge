import path from 'node:path';

function assertFilesArray(files) {
  if (!Array.isArray(files)) {
    throw new TypeError('Generated files must be returned as an array.');
  }

  if (files.length === 0) {
    throw new Error('Generated files array cannot be empty.');
  }
}

export function sanitizeFilePath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new TypeError('Each generated file must include a non-empty path.');
  }

  const normalizedSeparators = filePath.trim().replace(/\\/g, '/');

  if (
    normalizedSeparators.includes('\0') ||
    normalizedSeparators.startsWith('~') ||
    path.posix.isAbsolute(normalizedSeparators) ||
    path.win32.isAbsolute(normalizedSeparators)
  ) {
    throw new Error(`Unsafe file path rejected: ${filePath}`);
  }

  const normalizedPath = path.posix
    .normalize(normalizedSeparators)
    .replace(/^(\.\/)+/, '');

  if (
    normalizedPath === '.' ||
    normalizedPath === '..' ||
    normalizedPath.length === 0 ||
    normalizedPath.startsWith('../') ||
    normalizedPath.includes('/../')
  ) {
    throw new Error(`Path traversal detected in generated file path: ${filePath}`);
  }

  return normalizedPath;
}

export function validateFiles(files) {
  assertFilesArray(files);

  const seenPaths = new Set();
  const validatedFiles = files.map((file, index) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw new TypeError(`Generated file at index ${index} must be an object.`);
    }

    const sanitizedPath = sanitizeFilePath(file.path);

    if (typeof file.content !== 'string') {
      throw new TypeError(
        `Generated file "${sanitizedPath}" must include string content.`,
      );
    }

    if (seenPaths.has(sanitizedPath)) {
      throw new Error(`Duplicate generated file path detected: ${sanitizedPath}`);
    }

    seenPaths.add(sanitizedPath);

    return {
      path: sanitizedPath,
      content: file.content,
    };
  });

  return validatedFiles;
}

const validator = {
  sanitizeFilePath,
  validateFiles,
};

export default validator;
