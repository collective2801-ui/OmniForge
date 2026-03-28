import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  signIn,
  signOut,
  signUp,
} from '../backend/auth.js';
import {
  getAccessProfile,
  hasAccess,
  isSuperAdmin,
} from '../backend/accessControl.js';
import {
  createCheckoutSession,
  getBillingOverview,
  handleStripeWebhook,
} from '../backend/billing.js';
import {
  createProject as createDatabaseProject,
  getUserProjects,
  updateProject as updateDatabaseProject,
} from '../backend/db.js';
import { seedMasterAccount } from '../backend/masterAccount.js';
import { getProfileByUserId } from '../backend/profileStore.js';
import sessionStore from '../backend/sessionStore.js';
import { isSupabaseConfigured } from '../backend/supabaseClient.js';
import platformConfig from '../config/platform.config.js';
import contextMemory from '../engine/contextMemory.js';
import projectRegistry from '../engine/projectRegistry.js';
import { runTask as runOrchestratorTask } from '../orchestrator/orchestrator.js';

const PORT = Number(process.env.PORT || process.env.OMNIFORGE_PORT || 3001);
const HOST =
  process.env.OMNIFORGE_HOST ||
  (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const WEB_DIST_DIRECTORY = path.join(platformConfig.rootDirectory, 'apps', 'web', 'dist');
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME?.trim() || 'omniforge_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_ALLOWED_ORIGINS = Object.freeze([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:3001',
  'http://127.0.0.1:3001',
]);

const MIME_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
});

const taskStore = new Map();
const WORKSPACE_FILE_LIMIT = 72;
const WORKSPACE_FILE_SIZE_LIMIT = 220000;
const WORKSPACE_TEXT_EXTENSIONS = new Set([
  '.css',
  '.env',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.sql',
  '.svg',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.yml',
  '.yaml',
]);
const WORKSPACE_TEXT_FILENAMES = new Set([
  '.env.example',
  'dockerfile',
  'eas.json',
  'package.json',
  'railway.json',
  'readme.md',
  'vercel.json',
  'vite.config.js',
]);
const WORKSPACE_SKIP_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.turbo',
  'assets',
  'build',
  'builds',
  'coverage',
  'dist',
  'node_modules',
  'vendor',
]);

function updateTimestamp(record) {
  record.updatedAt = new Date().toISOString();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function getAllowedOrigins() {
  return unique([
    ...DEFAULT_ALLOWED_ORIGINS,
    ...(process.env.ALLOWED_ORIGINS?.split(',').map((entry) => entry.trim()) ?? []),
    process.env.FRONTEND_URL?.trim() || process.env.PLATFORM_URL?.trim() || '',
  ]);
}

function isAllowedOrigin(origin) {
  if (typeof origin !== 'string' || origin.trim().length === 0) {
    return false;
  }

  const normalizedOrigin = origin.trim();
  const allowedOrigins = getAllowedOrigins();

  if (allowedOrigins.includes(normalizedOrigin)) {
    return true;
  }

  return allowedOrigins.some((allowedOrigin) => {
    if (!allowedOrigin.includes('*')) {
      return false;
    }

    const escapedOrigin = allowedOrigin
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const pattern = new RegExp(`^${escapedOrigin}$`);
    return pattern.test(normalizedOrigin);
  });
}

function appendVaryHeader(response, value) {
  const current = response.getHeader('Vary');

  if (!current) {
    response.setHeader('Vary', value);
    return;
  }

  const next = Array.isArray(current) ? current.join(', ') : String(current);

  if (!next.split(',').map((entry) => entry.trim()).includes(value)) {
    response.setHeader('Vary', `${next}, ${value}`);
  }
}

function applyCorsHeaders(request, response) {
  const origin = request.headers.origin ?? '';
  appendVaryHeader(response, 'Origin');

  if (!isAllowedOrigin(origin)) {
    return;
  }

  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Credentials', 'true');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function getRequestIp(request) {
  const forwardedFor = request.headers['x-forwarded-for'];

  if (typeof forwardedFor === 'string' && forwardedFor.trim().length > 0) {
    return forwardedFor.split(',')[0].trim();
  }

  return request.socket.remoteAddress ?? '';
}

function getSessionCookieOptions() {
  const isProduction = process.env.NODE_ENV === 'production';
  const secure =
    /^(1|true|yes)$/i.test(process.env.SESSION_COOKIE_SECURE?.trim() ?? '') ||
    isProduction;
  const sameSite = secure ? 'None' : 'Lax';

  return {
    maxAge: Number(process.env.SESSION_TTL_SECONDS || SESSION_TTL_SECONDS),
    path: '/',
    httpOnly: true,
    sameSite,
    secure,
    domain: process.env.SESSION_COOKIE_DOMAIN?.trim() || undefined,
  };
}

function createServerEvent(type, payload = {}) {
  return {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload,
  };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function createOwnedProjectDirectoryName(projectId, projectName) {
  const slug = slugify(projectName || 'omniforge-project');
  const suffix = typeof projectId === 'string' ? projectId.slice(0, 8) : randomUUID().slice(0, 8);
  return `${slug || 'omniforge-project'}-${suffix}`;
}

function resolveOwnedProjectPath({ projectId, projectName, projectPath }) {
  if (typeof projectPath === 'string' && projectPath.trim().length > 0) {
    return path.resolve(projectPath.trim());
  }

  return path.join(
    platformConfig.workspaceRoot,
    createOwnedProjectDirectoryName(projectId, projectName),
  );
}

function createTask(prompt, {
  user = null,
  accessToken = '',
  refreshToken = '',
  projectId = null,
  projectName = '',
  projectPath = '',
  inputMode = 'text',
  builderContext = null,
  mode = 'prompt',
  analysis = null,
  selectedOption = null,
} = {}) {
  return {
    id: randomUUID(),
    prompt,
    inputMode,
    builderContext,
    mode,
    analysis,
    selectedOption,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    events: [],
    eventClients: new Set(),
    files: new Map(),
    result: null,
    error: null,
    user,
    accessToken,
    refreshToken,
    projectId,
    projectName,
    projectPath,
  };
}

function getProjectAccessOptions(user) {
  return {
    actorUser: user ?? null,
  };
}

function appendSetCookie(response, cookieValue) {
  const existingCookies = response.getHeader('Set-Cookie');

  if (!existingCookies) {
    response.setHeader('Set-Cookie', cookieValue);
    return;
  }

  const nextCookies = Array.isArray(existingCookies)
    ? [...existingCookies, cookieValue]
    : [existingCookies, cookieValue];

  response.setHeader('Set-Cookie', nextCookies);
}

function serializeCookie(name, value, {
  maxAge = null,
  expires = null,
  path: cookiePath = '/',
  httpOnly = true,
  sameSite = 'Lax',
  secure = false,
  domain = undefined,
} = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${cookiePath}`];

  if (typeof maxAge === 'number') {
    parts.push(`Max-Age=${maxAge}`);
  }

  if (expires instanceof Date) {
    parts.push(`Expires=${expires.toUTCString()}`);
  }

  if (typeof domain === 'string' && domain.trim().length > 0) {
    parts.push(`Domain=${domain.trim()}`);
  }

  if (httpOnly) {
    parts.push('HttpOnly');
  }

  parts.push(`SameSite=${sameSite}`);

  if (secure) {
    parts.push('Secure');
  }

  return parts.join('; ');
}

function parseCookies(request) {
  const cookieHeader = request.headers.cookie ?? '';

  return cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf('=');

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = entry.slice(0, separatorIndex);
      const value = entry.slice(separatorIndex + 1);
      cookies[key] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(payload);
}

async function parseJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new Error('Request body must be valid JSON.');
  }
}

async function readRawBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

function broadcastEvent(task, event) {
  task.events.push(event);
  updateTimestamp(task);

  for (const response of task.eventClients) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

async function createSessionRecord(authResult, request) {
  const createdSession = await sessionStore.createAppSession(authResult.user, {
    ttlSeconds: Number(process.env.SESSION_TTL_SECONDS || SESSION_TTL_SECONDS),
    userAgent: request.headers['user-agent'] ?? '',
    ipAddress: getRequestIp(request),
  });

  return {
    id: createdSession.session.id,
    token: createdSession.token,
    storage: createdSession.session.storage,
    user: authResult.user,
    accessToken: authResult.session?.accessToken ?? '',
    refreshToken: authResult.session?.refreshToken ?? '',
    createdAt: createdSession.session.createdAt,
    updatedAt: createdSession.session.updatedAt,
  };
}

function attachSessionCookie(response, sessionRecord) {
  appendSetCookie(
    response,
    serializeCookie(SESSION_COOKIE_NAME, sessionRecord.token, getSessionCookieOptions()),
  );
}

async function clearSessionCookie(request, response) {
  const cookies = parseCookies(request);
  const sessionToken = cookies[SESSION_COOKIE_NAME];

  if (sessionToken) {
    await sessionStore.deleteAppSession(sessionToken).catch(() => null);
  }

  appendSetCookie(
    response,
    serializeCookie(SESSION_COOKIE_NAME, '', {
      ...getSessionCookieOptions(),
      maxAge: 0,
      expires: new Date(0),
    }),
  );
}

async function getSessionFromRequest(request, { validateRemote = false } = {}) {
  const cookies = parseCookies(request);
  const sessionToken = cookies[SESSION_COOKIE_NAME];

  if (!sessionToken) {
    return null;
  }

  const sessionRecord = await sessionStore.getAppSession(sessionToken);

  if (!sessionRecord) {
    return null;
  }

  const profile = await getProfileByUserId(sessionRecord.userId).catch(() => null);
  const role = profile?.role ?? sessionRecord.role ?? 'user';
  const user = {
    id: sessionRecord.userId,
    email: profile?.email ?? sessionRecord.email ?? '',
    role,
    access: profile?.access ?? getAccessProfile({ role }),
    billingPlan: profile?.billingPlan ?? 'free',
    subscriptionStatus: profile?.subscriptionStatus ?? 'inactive',
  };

  if (validateRemote) {
    await sessionStore.touchAppSession(sessionToken, {
      userAgent: request.headers['user-agent'] ?? '',
      ipAddress: getRequestIp(request),
    }).catch(() => null);
  }

  return {
    id: sessionRecord.id,
    token: sessionToken,
    user,
    accessToken: '',
    refreshToken: '',
    createdAt: sessionRecord.createdAt,
    updatedAt: sessionRecord.updatedAt,
  };
}

async function requireSession(request, response) {
  const sessionRecord = await getSessionFromRequest(request, {
    validateRemote: true,
  });

  if (!sessionRecord) {
    sendJson(response, 401, {
      ok: false,
      error: {
        code: 'unauthorized',
        message: 'Authentication required.',
      },
    });
    return null;
  }

  return sessionRecord;
}

function taskBelongsToUser(task, user) {
  if (!task || !user) {
    return false;
  }

  return isSuperAdmin(user) || task.user?.id === user.id;
}

async function getOwnedTask(taskId, request, response) {
  const sessionRecord = await requireSession(request, response);

  if (!sessionRecord) {
    return {
      sessionRecord: null,
      task: null,
    };
  }

  const task = taskStore.get(taskId);

  if (!task || !taskBelongsToUser(task, sessionRecord.user)) {
    sendJson(response, 404, {
      error: {
        code: 'missing_task',
        message: 'Task not found.',
      },
    });

    return {
      sessionRecord,
      task: null,
    };
  }

  return {
    sessionRecord,
    task,
  };
}

async function getOwnedProjectRecord(sessionRecord, projectId) {
  const projectsResult = await getUserProjects(
    sessionRecord.user.id,
    sessionRecord.accessToken,
    getProjectAccessOptions(sessionRecord.user),
  );

  if (!projectsResult.ok) {
    return {
      project: null,
      error: {
        code: 'project_lookup_failed',
        message:
          projectsResult.error?.message ??
          'Unable to verify the selected project.',
      },
    };
  }

  const project = projectsResult.projects.find((entry) => entry.id === projectId) ?? null;

  if (!project) {
    return {
      project: null,
      error: {
        code: 'forbidden_project',
        message: 'The selected project does not belong to the current user.',
      },
    };
  }

  return {
    project,
    error: null,
  };
}

function normalizeProjectSnapshot(project, registryProject = null) {
  const metadata =
    project?.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
      ? project.metadata
      : {};
  const mergedProject = {
    id: project?.id ?? registryProject?.projectId ?? '',
    userId: project?.userId ?? project?.user_id ?? null,
    name: project?.name ?? registryProject?.projectName ?? 'Untitled project',
    path: project?.path ?? registryProject?.projectPath ?? '',
    createdAt: project?.createdAt ?? project?.created_at ?? registryProject?.createdAt ?? null,
    updatedAt: registryProject?.updatedAt ?? project?.updatedAt ?? project?.updated_at ?? null,
    projectType: registryProject?.projectType ?? project?.projectType ?? 'application',
    status: registryProject?.status ?? project?.status ?? 'draft',
    liveUrl: registryProject?.liveUrl ?? project?.liveUrl ?? project?.live_url ?? '',
    deploymentProvider:
      registryProject?.deploymentProvider ??
      project?.deploymentProvider ??
      project?.deployment_provider ??
      '',
    repositoryUrl:
      registryProject?.repositoryUrl ?? project?.repositoryUrl ?? project?.repository_url ?? '',
    customDomain:
      registryProject?.customDomain ?? project?.customDomain ?? project?.custom_domain ?? '',
    domainProvider: registryProject?.domainProvider ?? '',
    domainStatus: registryProject?.domainStatus ?? '',
    integrations: registryProject?.integrations ?? [],
    integrationProviders: registryProject?.integrationProviders ?? {},
    integrationEnvKeys: registryProject?.integrationEnvKeys ?? [],
    mobileStatus: registryProject?.mobileStatus ?? '',
    mobilePlatforms: registryProject?.mobilePlatforms ?? [],
    androidPackage: registryProject?.androidPackage ?? '',
    iosBundleIdentifier: registryProject?.iosBundleIdentifier ?? '',
    unifiedApis: registryProject?.unifiedApis ?? [],
    unifiedApiProviders: registryProject?.unifiedApiProviders ?? {},
    runtimeStatus: registryProject?.runtimeStatus ?? '',
    runtimeIssueCount: registryProject?.runtimeIssueCount ?? 0,
    runtimeIssuesFixed: registryProject?.runtimeIssuesFixed === true,
    runtimeSecurityWarningCount: registryProject?.runtimeSecurityWarningCount ?? 0,
    storeSubmissionReady: registryProject?.storeSubmissionReady === true,
    memoryUpdated: registryProject?.memoryUpdated === true,
    patternsLearned: registryProject?.patternsLearned === true,
    preferredUiStyle: registryProject?.preferredUiStyle ?? '',
    metadata,
  };

  return mergedProject;
}

function truncateStoredContent(value, maxLength = 80000) {
  const normalizedValue = typeof value === 'string' ? value : '';

  if (normalizedValue.length <= maxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, maxLength)}\n/* truncated for persistence */`;
}

function isWorkspaceTextFile(relativePath) {
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
  const basename = path.basename(normalizedPath).toLowerCase();
  const extension = path.extname(basename).toLowerCase();

  if (WORKSPACE_TEXT_FILENAMES.has(basename)) {
    return true;
  }

  return WORKSPACE_TEXT_EXTENSIONS.has(extension);
}

async function readTextFileIfExists(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function readJsonFileIfExists(filePath) {
  const contents = await readTextFileIfExists(filePath);

  if (!contents) {
    return null;
  }

  try {
    return JSON.parse(contents);
  } catch {
    return null;
  }
}

function createProjectLaunchUrl(project) {
  if (typeof project.customDomain === 'string' && project.customDomain.trim().length > 0) {
    return `https://${project.customDomain.trim()}`;
  }

  if (typeof project.liveUrl === 'string' && project.liveUrl.trim().length > 0) {
    return project.liveUrl.trim();
  }

  return '';
}

function extractSqlTableNames(schemaText = '') {
  const tableNames = [];
  const seen = new Set();
  const pattern = /create table(?: if not exists)?\s+(?:public\.)?("?[\w-]+"?)/gi;

  for (const match of String(schemaText).matchAll(pattern)) {
    const normalizedName = match[1].replace(/"/g, '');

    if (normalizedName && !seen.has(normalizedName)) {
      seen.add(normalizedName);
      tableNames.push(normalizedName);
    }
  }

  return tableNames;
}

async function collectWorkspaceFiles(projectPath, relativeDirectory = '', files = []) {
  if (!projectPath || files.length >= WORKSPACE_FILE_LIMIT) {
    return files;
  }

  const currentDirectory = path.join(projectPath, relativeDirectory);
  let entries = [];

  try {
    entries = await fs.readdir(currentDirectory, {
      withFileTypes: true,
    });
  } catch {
    return files;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (files.length >= WORKSPACE_FILE_LIMIT) {
      break;
    }

    const relativePath = path.join(relativeDirectory, entry.name);
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (WORKSPACE_SKIP_DIRECTORIES.has(entry.name.toLowerCase())) {
        continue;
      }

      await collectWorkspaceFiles(projectPath, relativePath, files);
      continue;
    }

    if (!entry.isFile() || !isWorkspaceTextFile(normalizedRelativePath)) {
      continue;
    }

    const absolutePath = path.join(projectPath, relativePath);

    try {
      const fileStat = await fs.stat(absolutePath);

      if (fileStat.size > WORKSPACE_FILE_SIZE_LIMIT) {
        continue;
      }
    } catch {
      continue;
    }

    const content = await readTextFileIfExists(absolutePath);

    if (!content || content.includes('\u0000')) {
      continue;
    }

    files.push({
      path: normalizedRelativePath,
      content,
    });
  }

  return files;
}

async function buildProjectWorkspace(project, registryProject = null) {
  const snapshot = normalizeProjectSnapshot(project, registryProject);
  const storedMetadata =
    snapshot.metadata && typeof snapshot.metadata === 'object' ? snapshot.metadata : {};
  const projectPath = snapshot.path || registryProject?.projectPath || '';
  const previewHtml = projectPath
    ? await readTextFileIfExists(path.join(projectPath, 'preview', 'index.html'))
    : '';
  const databasePath = projectPath ? path.join(projectPath, 'database', 'schema.sql') : '';
  const databaseContent = databasePath ? await readTextFileIfExists(databasePath) : '';
  const files = projectPath ? await collectWorkspaceFiles(projectPath) : [];
  const fallbackFiles = Array.isArray(storedMetadata.files) ? storedMetadata.files : [];
  const filteredFiles =
    (files.length > 0 ? files : fallbackFiles).filter((file) => file.path !== 'database/schema.sql');
  const launchUrl = createProjectLaunchUrl(snapshot);
  const finalization = projectPath
    ? await readJsonFileIfExists(path.join(projectPath, '.omniforge', 'finalization-report.json'))
    : null;
  const diagnostics = projectPath
    ? await readJsonFileIfExists(path.join(projectPath, 'runtime', 'runtime-diagnostics.json'))
    : null;
  const projectContext = projectPath
    ? await readJsonFileIfExists(path.join(projectPath, '.omniforge', 'project-context.json'))
    : null;

  return {
    project: snapshot,
    intent: projectContext?.intent ?? storedMetadata.intent ?? null,
    preview: {
      ready: Boolean(launchUrl || previewHtml || storedMetadata.preview?.html),
      mode:
        launchUrl
          ? 'live'
          : previewHtml || storedMetadata.preview?.html
            ? 'sandbox'
            : 'empty',
      url: launchUrl,
      html: previewHtml || storedMetadata.preview?.html || '',
      title:
        storedMetadata.preview?.title ||
        (snapshot.name ? `${snapshot.name} preview` : 'Project preview'),
      summary:
        launchUrl
          ? 'Live deployment available for this project.'
          : previewHtml || storedMetadata.preview?.html
            ? 'Local preview artifact loaded from the project workspace.'
            : 'Run a build to generate a preview for this project.',
    },
    files: filteredFiles,
    database: {
      path: 'database/schema.sql',
      content: databaseContent || storedMetadata.database?.content || '',
      tables: extractSqlTableNames(databaseContent || storedMetadata.database?.content || ''),
    },
    runtime: {
      finalization: finalization ?? storedMetadata.runtime?.finalization ?? null,
      diagnostics: diagnostics ?? storedMetadata.runtime?.diagnostics ?? null,
    },
    stats: {
      fileCount: filteredFiles.length,
      databaseReady: databaseContent.length > 0,
      previewReady: Boolean(launchUrl || previewHtml),
    },
  };
}

function createPersistedWorkspaceFiles(files = []) {
  return files
    .filter((file) => {
      if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
        return false;
      }

      return (
        file.path === '.env.example' ||
        file.path === 'README.md' ||
        file.path === 'package.json' ||
        file.path === 'vite.config.js' ||
        file.path.startsWith('src/') ||
        file.path.startsWith('api/') ||
        file.path.startsWith('database/') ||
        file.path.startsWith('integrations/') ||
        file.path.startsWith('preview/')
      );
    })
    .slice(0, 24)
    .map((file) => ({
      path: file.path,
      content: truncateStoredContent(file.content, 40000),
    }));
}

function buildProjectPersistenceMetadata(orchestrationResult, generatedFiles = []) {
  const previewFile = generatedFiles.find((file) => file.path === 'preview/index.html') ?? null;
  const databaseFile = generatedFiles.find((file) => file.path === 'database/schema.sql') ?? null;

  return {
    intent: orchestrationResult.intent ?? null,
    preview: previewFile
      ? {
          title: orchestrationResult.intent?.projectName
            ? `${orchestrationResult.intent.projectName} preview`
            : 'Project preview',
          html: truncateStoredContent(previewFile.content, 70000),
        }
      : null,
    database: databaseFile
      ? {
          content: truncateStoredContent(databaseFile.content, 50000),
          tables: extractSqlTableNames(databaseFile.content),
        }
      : null,
    runtime: {
      finalization: orchestrationResult.finalization ?? null,
      diagnostics: orchestrationResult.runtime ?? null,
    },
    files: createPersistedWorkspaceFiles(generatedFiles),
    savedAt: new Date().toISOString(),
  };
}

async function readGeneratedFiles(fileDescriptors = []) {
  const generatedFiles = [];

  for (const descriptor of fileDescriptors) {
    if (
      !descriptor ||
      typeof descriptor !== 'object' ||
      typeof descriptor.path !== 'string' ||
      typeof descriptor.absolutePath !== 'string'
    ) {
      continue;
    }

    try {
      const content = await fs.readFile(descriptor.absolutePath, 'utf8');
      generatedFiles.push({
        path: descriptor.path,
        content,
      });
    } catch {
      generatedFiles.push({
        path: descriptor.path,
        content: '',
      });
    }
  }

  return generatedFiles;
}

async function mergeGeneratedFiles(task, fileDescriptors = []) {
  const generatedFiles = await readGeneratedFiles(fileDescriptors);

  for (const file of generatedFiles) {
    task.files.set(file.path, file);
  }

  return [...task.files.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

async function persistOwnedProject(task, orchestrationResult) {
  if (!task.user) {
    return {
      databaseProject: null,
      databaseError: null,
    };
  }

  const projectName =
    task.projectName?.trim() || orchestrationResult.project?.projectName || orchestrationResult.intent?.projectName;
  const projectPath =
    task.projectPath ||
    orchestrationResult.project?.projectPath ||
    '';
  const generatedFiles = await readGeneratedFiles(orchestrationResult.files ?? []);
  const metadata = buildProjectPersistenceMetadata(orchestrationResult, generatedFiles);
  const updatePayload = {
    name: projectName,
    path: projectPath,
    status: orchestrationResult.project?.status ?? orchestrationResult.status ?? 'draft',
    liveUrl: orchestrationResult.url ?? orchestrationResult.deployment?.url ?? '',
    deploymentProvider: orchestrationResult.deployment?.provider ?? '',
    repositoryUrl: orchestrationResult.deployment?.repository?.htmlUrl ?? '',
    customDomain: orchestrationResult.domain?.domain ?? '',
    metadata,
  };

  if (task.projectId) {
    const updateResult = await updateDatabaseProject(
      task.projectId,
      updatePayload,
      task.accessToken,
      getProjectAccessOptions(task.user),
    );

    return {
      databaseProject: updateResult.ok ? updateResult.project : null,
      databaseError: updateResult.ok ? null : updateResult.error?.message ?? 'Unable to update project ownership record.',
    };
  }

  const createResult = await createDatabaseProject(
    task.user.id,
    updatePayload,
    task.accessToken,
    getProjectAccessOptions(task.user),
  );

  if (createResult.ok && createResult.project) {
    task.projectId = createResult.project.id;
  }

  return {
    databaseProject: createResult.ok ? createResult.project : null,
    databaseError: createResult.ok ? null : createResult.error?.message ?? 'Unable to create project ownership record.',
  };
}

async function buildPublicResult(task, orchestrationResult, persistenceResult = {}) {
  await mergeGeneratedFiles(task, orchestrationResult.files ?? []);
  const generatedFiles = [...task.files.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );

  return {
    taskId: task.id,
    sessionId: orchestrationResult.sessionId,
    status: orchestrationResult.status ?? task.status,
    workflowStatus: orchestrationResult.workflowStatus ?? null,
    url: orchestrationResult.url ?? orchestrationResult.deployment?.url ?? null,
    inputMode: orchestrationResult.inputMode ?? task.inputMode ?? 'text',
    mode: orchestrationResult.mode ?? task.mode ?? 'prompt',
    analysis: orchestrationResult.analysis ?? task.analysis ?? null,
    selectedOption: orchestrationResult.selectedOption ?? task.selectedOption ?? null,
    referenceContext: orchestrationResult.referenceContext ?? task.builderContext ?? null,
    intent: orchestrationResult.intent,
    route: orchestrationResult.route,
    plan: orchestrationResult.plan
      ? {
          planId: orchestrationResult.plan.planId,
          steps: orchestrationResult.plan.steps,
        }
      : null,
    project: orchestrationResult.project,
    databaseProject: persistenceResult.databaseProject ?? null,
    databaseError: persistenceResult.databaseError ?? null,
    access: orchestrationResult.access ?? null,
    intelligence: orchestrationResult.intelligence ?? null,
    finalization: orchestrationResult.finalization ?? null,
    architecture: orchestrationResult.architecture ?? null,
    uiState: orchestrationResult.uiState ?? null,
    cloneStructure: orchestrationResult.cloneStructure ?? null,
    injectedComponents: orchestrationResult.injectedComponents ?? [],
    mobile: orchestrationResult.mobile ?? null,
    mobileMetadata: orchestrationResult.mobileMetadata ?? null,
    store: orchestrationResult.store ?? null,
    unifiedAPI: orchestrationResult.unifiedAPI ?? null,
    runtime: orchestrationResult.runtime ?? null,
    integrations: orchestrationResult.integrations ?? null,
    deployment: orchestrationResult.deployment ?? null,
    domain: orchestrationResult.domain ?? null,
    dns: orchestrationResult.dns ?? null,
    infrastructure: orchestrationResult.infrastructure ?? null,
    product: orchestrationResult.product ?? null,
    business: orchestrationResult.business ?? null,
    growth: orchestrationResult.growth ?? null,
    autonomous: orchestrationResult.autonomous === true,
    businessReady: orchestrationResult.businessReady === true,
    memoryContext: orchestrationResult.memoryContext ?? null,
    decisionLog: orchestrationResult.decisionLog ?? [],
    memoryEntryId: orchestrationResult.memoryEntryId ?? null,
    memoryUpdated: orchestrationResult.memoryUpdated === true,
    patternsLearned: orchestrationResult.patternsLearned === true,
    preferencesUpdated: orchestrationResult.preferencesUpdated === true,
    validated: orchestrationResult.validated === true,
    productionReady: orchestrationResult.productionReady === true,
    generatedFiles,
    execution: orchestrationResult.execution
      ? {
          summary: orchestrationResult.execution.summary,
          stepResults: orchestrationResult.execution.stepResults.map((stepResult) => ({
            stepId: stepResult.stepId,
            title: stepResult.title,
            agent: stepResult.agent,
            action: stepResult.action,
            status: stepResult.status,
            summary: stepResult.summary,
            metadata: stepResult.metadata ?? {},
          })),
        }
      : null,
  };
}

async function enrichProgressEvent(task, event) {
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
    return createServerEvent('system_error', {
      message: 'Invalid task progress event received from orchestrator.',
    });
  }

  if (event.type === 'task_completed' || event.type === 'task_failed') {
    return null;
  }

  if (event.type === 'step_completed') {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload?.result?.files ?? []);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'domain_ready' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'api_integrations_ready' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'build_finalized' && Array.isArray(event.payload?.finalization?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.finalization.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'autonomous_product_ready' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'business_model_ready' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'growth_plan_ready' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'autonomous_mode_completed' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'dns_configured' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'infrastructure_ready' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'component_injected' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'mobile_build_ready' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'store_submission_ready' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'unified_api_ready' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'runtime_monitor_completed' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  if (event.type === 'runtime_auto_fix_applied' && Array.isArray(event.payload?.files)) {
    const generatedFiles = await mergeGeneratedFiles(task, event.payload.files);

    return createServerEvent(event.type, {
      ...event.payload,
      generatedFiles,
    });
  }

  return createServerEvent(event.type, event.payload);
}

function summarizeTask(task) {
  return {
    taskId: task.id,
    prompt: task.prompt,
    inputMode: task.inputMode ?? 'text',
    mode: task.mode ?? 'prompt',
    analysis: task.analysis ?? null,
    selectedOption: task.selectedOption ?? null,
    builderContext: task.builderContext ?? null,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    fileCount: task.files.size,
    error: task.error,
    result: task.result,
  };
}

async function executeTask(task) {
  task.status = 'running';
  updateTimestamp(task);

  try {
    const orchestrationResult = await runOrchestratorTask(task.prompt, {
      userId: task.user?.id ?? 'anonymous',
      user: task.user ?? null,
      inputMode: task.inputMode ?? 'text',
      mode: task.mode ?? 'prompt',
      analysis: task.analysis ?? null,
      selectedOption: task.selectedOption ?? null,
      builderContext: task.builderContext ?? null,
      project: task.projectId
        ? {
            projectId: task.projectId,
            projectName: task.projectName,
            projectPath: task.projectPath,
          }
        : null,
      onProgress: async (event) => {
        const enrichedEvent = await enrichProgressEvent(task, event);

        if (enrichedEvent) {
          broadcastEvent(task, enrichedEvent);
        }
      },
    });

    const persistenceResult = await persistOwnedProject(task, orchestrationResult);

    if (persistenceResult.databaseError) {
      broadcastEvent(
        task,
        createServerEvent('database_warning', {
          message: persistenceResult.databaseError,
        }),
      );
    }

    task.result = await buildPublicResult(task, orchestrationResult, persistenceResult);
    task.status = 'completed';
    task.error = null;
    updateTimestamp(task);
    broadcastEvent(task, createServerEvent('task_completed', task.result));
  } catch (error) {
    task.status = 'failed';
    task.error = error?.message ?? 'Unknown task failure.';
    updateTimestamp(task);
    broadcastEvent(
      task,
      createServerEvent('task_failed', {
        taskId: task.id,
        message: task.error,
      }),
    );
  }
}

async function serveStaticAsset(response, pathname) {
  const normalizedPath = pathname === '/' ? '/index.html' : pathname;
  const targetPath = path.join(WEB_DIST_DIRECTORY, normalizedPath.replace(/^\/+/, ''));

  try {
    const stat = await fs.stat(targetPath);

    if (!stat.isFile()) {
      throw new Error('Not a file.');
    }

    const content = await fs.readFile(targetPath);
    const extension = path.extname(targetPath);
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[extension] ?? 'application/octet-stream',
      'Cache-Control': extension === '.html' ? 'no-store' : 'public, max-age=300',
    });
    response.end(content);
    return true;
  } catch {
    return false;
  }
}

async function serveIndexHtml(response) {
  const indexPath = path.join(WEB_DIST_DIRECTORY, 'index.html');

  try {
    const content = await fs.readFile(indexPath);
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(content);
  } catch {
    sendText(
      response,
      503,
      'OmniForge web assets are not built yet. Run "npm run build:web" first.',
    );
  }
}

async function handleAuthRequest(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/auth/me') {
    const sessionRecord = await getSessionFromRequest(request, {
      validateRemote: true,
    });

    if (!sessionRecord) {
      sendJson(response, 200, {
        ok: false,
        user: null,
        error: null,
      });
      return true;
    }

    sendJson(response, 200, {
      ok: true,
      user: sessionRecord.user,
      error: null,
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/signup') {
    const payload = await parseJsonBody(request);
    const result = await signUp(payload.email, payload.password);

    if (result.ok && result.user && result.session) {
      const sessionRecord = await createSessionRecord(result, request);
      attachSessionCookie(response, sessionRecord);
    }

    sendJson(response, result.ok ? 200 : 400, result);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/signin') {
    const payload = await parseJsonBody(request);
    const result = await signIn(payload.email, payload.password);

    if (result.ok && result.user && result.session) {
      const sessionRecord = await createSessionRecord(result, request);
      attachSessionCookie(response, sessionRecord);
    }

    sendJson(response, result.ok ? 200 : 400, result);
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/auth/signout') {
    const sessionRecord = await getSessionFromRequest(request);

    if (sessionRecord) {
      await signOut({
        accessToken: sessionRecord.accessToken,
        refreshToken: sessionRecord.refreshToken,
      });
    }

    await clearSessionCookie(request, response);
    sendJson(response, 200, {
      ok: true,
      error: null,
    });
    return true;
  }

  return false;
}

async function handleProjectRequest(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/projects') {
    const sessionRecord = await requireSession(request, response);

    if (!sessionRecord) {
      return true;
    }

    const result = await getUserProjects(
      sessionRecord.user.id,
      sessionRecord.accessToken,
      getProjectAccessOptions(sessionRecord.user),
    );

    if (!result.ok) {
      sendJson(response, 400, result);
      return true;
    }

    const registryProjects = await projectRegistry.listProjects();
    const registryById = new Map(
      registryProjects.map((project) => [project.projectId, project]),
    );
    const mergedProjects = (result.projects ?? []).map((project) => {
      const snapshot = normalizeProjectSnapshot(project, registryById.get(project.id));
      delete snapshot.metadata;
      return snapshot;
    });

    sendJson(response, 200, {
      ...result,
      projects: mergedProjects,
    });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/projects') {
    const sessionRecord = await requireSession(request, response);

    if (!sessionRecord) {
      return true;
    }

    const payload = await parseJsonBody(request);
    const projectId = randomUUID();
    const projectName =
      typeof payload.name === 'string' ? payload.name.trim() : '';
    const projectPath = resolveOwnedProjectPath({
      projectId,
      projectName,
      projectPath: typeof payload.path === 'string' ? payload.path : '',
    });
    const result = await createDatabaseProject(
      sessionRecord.user.id,
      {
        id: projectId,
        name: projectName,
        path: projectPath,
      },
      sessionRecord.accessToken,
      getProjectAccessOptions(sessionRecord.user),
    );

    sendJson(response, result.ok ? 200 : 400, result);
    return true;
  }

  const updateMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  const workspaceMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/workspace$/);

  if (request.method === 'GET' && workspaceMatch) {
    const sessionRecord = await requireSession(request, response);

    if (!sessionRecord) {
      return true;
    }

    const projectId = decodeURIComponent(workspaceMatch[1]);
    const ownedProjectResult = await getOwnedProjectRecord(
      sessionRecord,
      projectId,
    );

    if (ownedProjectResult.error) {
      sendJson(response, 403, {
        ok: false,
        error: ownedProjectResult.error,
      });
      return true;
    }

    const registryProject = await projectRegistry.getProjectById(projectId).catch(() => null);
    const workspace = await buildProjectWorkspace(
      ownedProjectResult.project,
      registryProject,
    );

    sendJson(response, 200, {
      ok: true,
      workspace,
      error: null,
    });
    return true;
  }

  if (request.method === 'PATCH' && updateMatch) {
    const sessionRecord = await requireSession(request, response);

    if (!sessionRecord) {
      return true;
    }

    const payload = await parseJsonBody(request);
    const projectId = decodeURIComponent(updateMatch[1]);
    const result = await updateDatabaseProject(
      projectId,
      payload,
      sessionRecord.accessToken,
      getProjectAccessOptions(sessionRecord.user),
    );

    sendJson(response, result.ok ? 200 : 400, result);
    return true;
  }

  return false;
}

async function handleBillingRequest(request, response, url) {
  if (request.method === 'POST' && url.pathname === '/api/billing/webhook') {
    try {
      const rawBody = await readRawBody(request);
      const signature = request.headers['stripe-signature'] ?? '';
      const result = await handleStripeWebhook(rawBody, signature);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, {
        ok: false,
        error: {
          code: 'billing_webhook_failed',
          message: error?.message ?? 'Stripe webhook processing failed.',
        },
      });
    }

    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/billing/config') {
    const sessionRecord = await requireSession(request, response);

    if (!sessionRecord) {
      return true;
    }

    try {
      const overview = await getBillingOverview(sessionRecord.user);
      sendJson(response, 200, overview);
    } catch (error) {
      sendJson(response, 400, {
        error: {
          code: 'billing_config_failed',
          message: error?.message ?? 'Unable to load billing configuration.',
        },
      });
    }

    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/billing/subscription') {
    const sessionRecord = await requireSession(request, response);

    if (!sessionRecord) {
      return true;
    }

    try {
      const overview = await getBillingOverview(sessionRecord.user);
      sendJson(response, 200, {
        subscription: overview.subscription,
        configured: overview.configured,
      });
    } catch (error) {
      sendJson(response, 400, {
        error: {
          code: 'billing_subscription_failed',
          message: error?.message ?? 'Unable to load subscription status.',
        },
      });
    }

    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/billing/checkout') {
    const sessionRecord = await requireSession(request, response);

    if (!sessionRecord) {
      return true;
    }

    try {
      const payload = await parseJsonBody(request);
      const result = await createCheckoutSession({
        user: sessionRecord.user,
        planId: typeof payload.planId === 'string' ? payload.planId.trim() : '',
        origin: request.headers.origin ?? process.env.FRONTEND_URL ?? process.env.PLATFORM_URL ?? '',
      });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, {
        error: {
          code: 'billing_checkout_failed',
          message: error?.message ?? 'Unable to create checkout session.',
        },
      });
    }

    return true;
  }

  return false;
}

async function handleApiRequest(request, response, url) {
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, {
      status: 'ok',
      service: 'omniforge',
      port: PORT,
      supabaseConfigured: isSupabaseConfigured,
      allowedOrigins: getAllowedOrigins(),
      timestamp: new Date().toISOString(),
    });
    return true;
  }

  if (url.pathname.startsWith('/api/auth/')) {
    return handleAuthRequest(request, response, url);
  }

  if (url.pathname.startsWith('/api/projects')) {
    return handleProjectRequest(request, response, url);
  }

  if (url.pathname.startsWith('/api/billing')) {
    return handleBillingRequest(request, response, url);
  }

  if (request.method === 'GET' && url.pathname === '/api/engine/projects') {
    const sessionRecord = await requireSession(request, response);

    if (!sessionRecord) {
      return true;
    }

    if (!hasAccess(sessionRecord.user, 'view_all_projects')) {
      sendJson(response, 403, {
        error: {
          code: 'forbidden',
          message: 'Administrative access is required to view all platform projects.',
        },
      });
      return true;
    }

    const projects = await projectRegistry.listProjects();
    sendJson(response, 200, { projects });
    return true;
  }

  if (request.method === 'GET' && url.pathname === '/api/sessions') {
    const sessionRecord = await requireSession(request, response);

    if (!sessionRecord) {
      return true;
    }

    if (!hasAccess(sessionRecord.user, 'view_platform_sessions')) {
      sendJson(response, 403, {
        error: {
          code: 'forbidden',
          message: 'Administrative access is required to inspect platform sessions.',
        },
      });
      return true;
    }

    const sessions = await contextMemory.getRecentSessions(20);
    sendJson(response, 200, { sessions });
    return true;
  }

  if (request.method === 'POST' && url.pathname === '/api/tasks') {
    const sessionRecord = await requireSession(request, response);

    if (!sessionRecord) {
      return true;
    }

    try {
      const payload = await parseJsonBody(request);
      const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
      const projectId =
        typeof payload.projectId === 'string' && payload.projectId.trim().length > 0
          ? payload.projectId.trim()
          : null;
      const projectName =
        typeof payload.projectName === 'string' ? payload.projectName.trim() : '';
      const inputMode = payload.inputMode === 'voice' ? 'voice' : 'text';
      const mode = payload.mode === 'analyze' ? 'analyze' : 'prompt';
      const builderContext =
        payload.builderContext && typeof payload.builderContext === 'object'
          ? payload.builderContext
          : null;
      const analysis =
        payload.analysis && typeof payload.analysis === 'object'
          ? payload.analysis
          : null;
      const selectedOption =
        payload.selectedOption && typeof payload.selectedOption === 'object'
          ? payload.selectedOption
          : null;

      if (!prompt) {
        sendJson(response, 400, {
          error: {
            code: 'invalid_prompt',
            message: 'Prompt is required.',
          },
        });
        return true;
      }

      let ownedProject = null;

      if (projectId) {
        const ownedProjectResult = await getOwnedProjectRecord(
          sessionRecord,
          projectId,
        );

        if (ownedProjectResult.error) {
          sendJson(response, 403, {
            error: ownedProjectResult.error,
          });
          return true;
        }

        ownedProject = ownedProjectResult.project;
      }

      const task = createTask(prompt, {
        user: sessionRecord.user,
        accessToken: sessionRecord.accessToken,
        refreshToken: sessionRecord.refreshToken,
        projectId,
        projectName: ownedProject?.name ?? projectName,
        inputMode,
        mode,
        analysis,
        selectedOption,
        builderContext,
        projectPath: ownedProject
          ? resolveOwnedProjectPath({
              projectId: ownedProject.id,
              projectName: ownedProject.name,
              projectPath: ownedProject.path,
            })
          : '',
      });
      taskStore.set(task.id, task);

      sendJson(response, 202, {
        taskId: task.id,
        status: task.status,
      });

      broadcastEvent(
        task,
        createServerEvent('task_received', {
          taskId: task.id,
          prompt,
          inputMode,
          mode,
          analysis,
          selectedOption,
          referenceCount: Array.isArray(builderContext?.references)
            ? builderContext.references.length
            : 0,
        }),
      );
      void executeTask(task);
      return true;
    } catch (error) {
      sendJson(response, 400, {
        error: {
          code: 'invalid_request',
          message: error?.message ?? 'Unable to parse request payload.',
        },
      });
      return true;
    }
  }

  const streamMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/stream$/);

  if (request.method === 'GET' && streamMatch) {
    const taskId = decodeURIComponent(streamMatch[1]);
    const { task } = await getOwnedTask(taskId, request, response);

    if (!task) {
      return true;
    }

    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    response.write('\n');

    task.eventClients.add(response);

    for (const event of task.events) {
      response.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    const keepAlive = setInterval(() => {
      response.write(': keepalive\n\n');
    }, 15000);

    request.on('close', () => {
      clearInterval(keepAlive);
      task.eventClients.delete(response);
    });

    return true;
  }

  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/);

  if (request.method === 'GET' && taskMatch) {
    const taskId = decodeURIComponent(taskMatch[1]);
    const { task } = await getOwnedTask(taskId, request, response);

    if (!task) {
      return true;
    }

    sendJson(response, 200, summarizeTask(task));
    return true;
  }

  return false;
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host || `${HOST}:${PORT}`}`);

  try {
    if (requestUrl.pathname.startsWith('/api/')) {
      applyCorsHeaders(request, response);
      const handled = await handleApiRequest(request, response, requestUrl);

      if (!handled) {
        sendJson(response, 404, {
          error: {
            code: 'missing_route',
            message: 'API route not found.',
          },
        });
      }

      return;
    }

    const servedAsset = await serveStaticAsset(response, requestUrl.pathname);

    if (!servedAsset) {
      await serveIndexHtml(response);
    }
  } catch (error) {
    sendJson(response, 500, {
      error: error?.message ?? 'Unexpected OmniForge server failure.',
    });
  }
});

const masterAccountSeed = await seedMasterAccount();

if (!masterAccountSeed.ok && process.env.MASTER_EMAIL?.trim()) {
  console.warn(
    `Master account seeding was skipped: ${masterAccountSeed.error}`,
  );
}

server.listen(PORT, HOST, () => {
  console.log(`Backend listening on ${PORT}`);
});
