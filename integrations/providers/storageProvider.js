import path from 'node:path';
import { writeFileSafe } from '../../engine/fileSystem.js';

const STORAGE_ENV_ENTRIES = Object.freeze([
  {
    key: 'STORAGE_BUCKET',
    service: 'storage',
    provider: 'supabase-storage',
    description: 'Default storage bucket name used by the upload service.',
    required: true,
  },
  {
    key: 'SUPABASE_URL',
    service: 'storage',
    provider: 'supabase-storage',
    description: 'Supabase project URL used for storage uploads.',
    required: true,
  },
  {
    key: 'SUPABASE_ANON_KEY',
    service: 'storage',
    provider: 'supabase-storage',
    description: 'Supabase anonymous key used for storage API requests.',
    required: true,
  },
  {
    key: 'SUPABASE_SERVICE_ROLE_KEY',
    service: 'storage',
    provider: 'supabase-storage',
    description: 'Server-side Supabase key used for privileged uploads.',
    required: true,
  },
  {
    key: 'AWS_S3_BUCKET',
    service: 'storage',
    provider: 's3-ready',
    description: 'Target S3 bucket for presigned uploads.',
    required: false,
  },
  {
    key: 'AWS_REGION',
    service: 'storage',
    provider: 's3-ready',
    description: 'AWS region for the S3 bucket.',
    required: false,
  },
  {
    key: 'AWS_ACCESS_KEY_ID',
    service: 'storage',
    provider: 's3-ready',
    description: 'Server-side AWS access key used only when generating presigned upload URLs.',
    required: false,
  },
  {
    key: 'AWS_SECRET_ACCESS_KEY',
    service: 'storage',
    provider: 's3-ready',
    description: 'Server-side AWS secret used only when generating presigned upload URLs.',
    required: false,
  },
]);

function assertProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new TypeError('Project path is required for storage integration scaffolding.');
  }
}

async function writeGeneratedFiles(projectPath, files) {
  const writtenFiles = [];

  for (const file of files) {
    const absolutePath = path.join(projectPath, file.path);
    await writeFileSafe(absolutePath, file.content);
    writtenFiles.push({
      path: file.path,
      absolutePath,
    });
  }

  return writtenFiles;
}

function buildUploadServiceTemplate(selectedProvider) {
  return `import { uploadToS3PresignedUrl } from './providers/s3Storage.js';
import { uploadToSupabaseStorage } from './providers/supabaseStorage.js';

const PROVIDERS = {
  's3-ready': uploadToS3PresignedUrl,
  'supabase-storage': uploadToSupabaseStorage,
};

export async function uploadFile({
  provider = '${selectedProvider}',
  ...options
} = {}) {
  const handler = PROVIDERS[provider];

  if (typeof handler !== 'function') {
    throw new Error(\`Unsupported storage provider: \${provider}\`);
  }

  return handler(options);
}

export function createUploadPlan({
  provider = '${selectedProvider}',
  bucket = process.env.STORAGE_BUCKET || 'uploads',
  objectKey = '',
} = {}) {
  return {
    provider,
    bucket,
    objectKey,
    recommendedFlow:
      provider === 's3-ready'
        ? 'Generate a presigned URL on the server, then upload with the client.'
        : 'Upload through the server with a scoped Supabase token or service role key.',
  };
}

export default uploadFile;
`;
}

function buildSupabaseStorageTemplate() {
  return `function requireEnv(name, fallback = '') {
  const value = process.env[name]?.trim() || fallback;

  if (!value) {
    throw new Error(\`Missing required environment variable: \${name}\`);
  }

  return value;
}

function normalizeUploadPath(pathname) {
  return String(pathname || '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

export async function uploadToSupabaseStorage({
  file,
  bucket = process.env.STORAGE_BUCKET || 'uploads',
  objectKey = '',
  accessToken = '',
  contentType = '',
} = {}) {
  if (!file) {
    throw new TypeError('file is required for Supabase storage uploads.');
  }

  const baseUrl = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? '';
  const authToken = accessToken || serviceRoleKey || anonKey;
  const normalizedKey = normalizeUploadPath(objectKey || file.name || \`upload-\${Date.now()}\`);
  const endpoint = \`\${baseUrl}/storage/v1/object/\${encodeURIComponent(bucket)}/\${normalizedKey}\`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: \`Bearer \${authToken}\`,
      apikey: anonKey,
      'Content-Type': contentType || file.type || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: file,
  });
  const rawBody = await response.text();
  let payload = {};

  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload?.message ?? 'Supabase storage upload failed.');
  }

  return {
    provider: 'supabase-storage',
    bucket,
    key: normalizedKey,
    raw: payload,
  };
}

export default uploadToSupabaseStorage;
`;
}

function buildS3StorageTemplate() {
  return `function assertPresignedRequest(presignedRequest) {
  if (!presignedRequest || typeof presignedRequest !== 'object') {
    throw new TypeError('presignedRequest is required for S3 uploads.');
  }

  if (typeof presignedRequest.url !== 'string' || presignedRequest.url.trim().length === 0) {
    throw new TypeError('presignedRequest.url is required.');
  }
}

export async function uploadToS3PresignedUrl({
  file,
  presignedRequest,
  contentType = '',
} = {}) {
  if (!file) {
    throw new TypeError('file is required for S3 uploads.');
  }

  assertPresignedRequest(presignedRequest);

  const headers = new Headers(presignedRequest.headers ?? {});

  if (contentType || file.type) {
    headers.set('Content-Type', contentType || file.type);
  }

  const response = await fetch(presignedRequest.url, {
    method: presignedRequest.method ?? 'PUT',
    headers,
    body: file,
  });

  if (!response.ok) {
    throw new Error(\`S3 upload failed with status \${response.status}.\`);
  }

  return {
    provider: 's3-ready',
    key: presignedRequest.key ?? null,
    bucket: presignedRequest.bucket ?? null,
    publicUrl: presignedRequest.publicUrl ?? null,
  };
}

export function createS3UploadRequest({
  key,
  bucket = process.env.AWS_S3_BUCKET || '',
  region = process.env.AWS_REGION || '',
} = {}) {
  return {
    provider: 's3-ready',
    bucket,
    region,
    key,
    instructions: 'Generate a presigned upload URL on the server with AWS credentials, then call uploadToS3PresignedUrl on the client or edge runtime.',
  };
}

export default uploadToS3PresignedUrl;
`;
}

function buildStorageReadme(selectedProvider) {
  return `# Storage Integration

## Selected Provider

${selectedProvider}

## Generated Modules

- \`integrations/storage/uploadService.js\`
- \`integrations/storage/providers/supabaseStorage.js\`
- \`integrations/storage/providers/s3Storage.js\`

## Secure Usage Notes

- Use server-issued tokens or service role keys for privileged Supabase uploads.
- Never expose raw AWS credentials to the browser.
- Prefer presigned URLs for S3-compatible uploads.
`;
}

export async function setupStorageIntegration(projectPath, {
  selectedProvider = 'supabase-storage',
} = {}) {
  assertProjectPath(projectPath);

  const files = [
    {
      path: 'integrations/storage/uploadService.js',
      content: buildUploadServiceTemplate(selectedProvider),
    },
    {
      path: 'integrations/storage/providers/supabaseStorage.js',
      content: buildSupabaseStorageTemplate(),
    },
    {
      path: 'integrations/storage/providers/s3Storage.js',
      content: buildS3StorageTemplate(),
    },
    {
      path: 'integrations/storage/README.md',
      content: buildStorageReadme(selectedProvider),
    },
  ];
  const writtenFiles = await writeGeneratedFiles(projectPath, files);

  return {
    integrationId: 'storage',
    service: 'storage',
    provider: selectedProvider,
    alternatives: ['s3-ready'],
    envEntries: [...STORAGE_ENV_ENTRIES],
    files: writtenFiles,
    notes: [
      'Supabase storage is the default provider because it pairs well with managed auth and database services.',
      'An S3-ready upload path is scaffolded alongside the default provider for future portability.',
    ],
  };
}

export default {
  setupStorageIntegration,
};
