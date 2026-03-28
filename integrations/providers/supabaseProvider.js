import path from 'node:path';
import { writeFileSafe } from '../../engine/fileSystem.js';

const SUPABASE_ENV_ENTRIES = Object.freeze([
  {
    key: 'SUPABASE_URL',
    service: 'auth',
    provider: 'supabase',
    description: 'Supabase project URL.',
    required: true,
  },
  {
    key: 'SUPABASE_ANON_KEY',
    service: 'auth',
    provider: 'supabase',
    description: 'Public anonymous client key used by the browser client.',
    required: true,
  },
  {
    key: 'SUPABASE_SERVICE_ROLE_KEY',
    service: 'auth',
    provider: 'supabase',
    description: 'Server-side service role key for privileged operations.',
    required: true,
  },
]);

function assertProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new TypeError('Project path is required for Supabase integration scaffolding.');
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

function buildSupabaseClientTemplate() {
  return `import { createClient } from '@supabase/supabase-js';

function requireEnv(name, fallback = '') {
  const value = process.env[name]?.trim() || fallback;

  if (!value) {
    throw new Error(\`Missing required environment variable: \${name}\`);
  }

  return value;
}

export function createBrowserSupabaseClient() {
  const url = requireEnv('SUPABASE_URL');
  const anonKey = requireEnv('SUPABASE_ANON_KEY');

  return createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

export function createServerSupabaseClient(accessToken = '') {
  const url = requireEnv('SUPABASE_URL');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || requireEnv('SUPABASE_ANON_KEY');
  const headers = accessToken
    ? {
        Authorization: \`Bearer \${accessToken}\`,
      }
    : {};

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers,
    },
  });
}

export default createBrowserSupabaseClient;
`;
}

function buildSupabaseAuthAdapterTemplate() {
  return `import { createBrowserSupabaseClient } from './supabaseClient.js';

function createErrorResponse(code, message) {
  return {
    ok: false,
    user: null,
    session: null,
    error: {
      code,
      message,
    },
  };
}

function createSuccessResponse({
  user = null,
  session = null,
} = {}) {
  return {
    ok: true,
    user,
    session,
    error: null,
  };
}

function normalizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    email: user.email ?? '',
    createdAt: user.created_at ?? null,
  };
}

function normalizeSession(session) {
  if (!session) {
    return null;
  }

  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresAt: session.expires_at ?? null,
  };
}

export async function signUp(email, password) {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
  });

  if (error) {
    return createErrorResponse('signup_failed', error.message);
  }

  return createSuccessResponse({
    user: normalizeUser(data.user),
    session: normalizeSession(data.session),
  });
}

export async function signIn(email, password) {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return createErrorResponse('signin_failed', error.message);
  }

  return createSuccessResponse({
    user: normalizeUser(data.user),
    session: normalizeSession(data.session),
  });
}

export async function signOut() {
  const supabase = createBrowserSupabaseClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    return createErrorResponse('signout_failed', error.message);
  }

  return createSuccessResponse();
}

export async function getCurrentUser() {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase.auth.getUser();

  if (error) {
    return createErrorResponse('user_lookup_failed', error.message);
  }

  return createSuccessResponse({
    user: normalizeUser(data.user),
  });
}

export default {
  signUp,
  signIn,
  signOut,
  getCurrentUser,
};
`;
}

function buildSupabaseReadme() {
  return `# Supabase Auth Integration

## Generated Modules

- \`integrations/supabase/supabaseClient.js\`
- \`integrations/supabase/authAdapter.js\`

## Integration Notes

- The generated auth adapter mirrors the structured response format already used by OmniForge backend auth helpers.
- Keep \`SUPABASE_SERVICE_ROLE_KEY\` on the server only.
- Use the browser client for sign-in and sign-up flows, and reserve privileged actions for the server client.
`;
}

export async function setupSupabaseIntegration(projectPath) {
  assertProjectPath(projectPath);

  const files = [
    {
      path: 'integrations/supabase/supabaseClient.js',
      content: buildSupabaseClientTemplate(),
    },
    {
      path: 'integrations/supabase/authAdapter.js',
      content: buildSupabaseAuthAdapterTemplate(),
    },
    {
      path: 'integrations/supabase/README.md',
      content: buildSupabaseReadme(),
    },
  ];
  const writtenFiles = await writeGeneratedFiles(projectPath, files);

  return {
    integrationId: 'auth',
    service: 'auth',
    provider: 'supabase',
    envEntries: [...SUPABASE_ENV_ENTRIES],
    files: writtenFiles,
    notes: [
      'Supabase auth scaffolding matches the structured response contract used by existing OmniForge auth helpers.',
      'Browser and server clients are separated to keep privileged keys out of client code.',
    ],
  };
}

export default {
  setupSupabaseIntegration,
};
