import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  ensureDirectory,
  fileExists,
  readFileSafe,
  writeFileSafe,
} from '../engine/fileSystem.js';

const execFileAsync = promisify(execFile);
const DEFAULT_BRANCH = 'main';
const DEFAULT_COMMIT_MESSAGE = 'chore: prepare OmniForge deployment';
const GITHUB_API_URL = 'https://api.github.com';

function assertProjectPath(projectPath) {
  if (typeof projectPath !== 'string' || projectPath.trim().length === 0) {
    throw new TypeError('Project path must be a non-empty string.');
  }
}

function sanitizeRepoName(repoName) {
  if (typeof repoName !== 'string' || repoName.trim().length === 0) {
    throw new TypeError('Repository name must be a non-empty string.');
  }

  return repoName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80);
}

function getGitHubConfig() {
  const token = process.env.GITHUB_TOKEN?.trim() ?? '';
  const username = process.env.GITHUB_USERNAME?.trim() ?? '';

  if (!token) {
    throw new Error('Missing required environment variable: GITHUB_TOKEN');
  }

  if (!username) {
    throw new Error('Missing required environment variable: GITHUB_USERNAME');
  }

  return {
    token,
    username,
  };
}

async function runGit(args, { cwd, allowFailure = false } = {}) {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      env: process.env,
      maxBuffer: 10 * 1024 * 1024,
    });

    return {
      code: 0,
      stdout: result.stdout.trim(),
      stderr: result.stderr.trim(),
    };
  } catch (error) {
    if (allowFailure) {
      return {
        code: typeof error?.code === 'number' ? error.code : 1,
        stdout: typeof error?.stdout === 'string' ? error.stdout.trim() : '',
        stderr: typeof error?.stderr === 'string' ? error.stderr.trim() : '',
      };
    }

    throw new Error(
      error?.stderr?.trim() ||
        error?.stdout?.trim() ||
        error?.message ||
        'Git command failed.',
    );
  }
}

async function ensureGitignore(projectPath) {
  const gitignorePath = path.join(projectPath, '.gitignore');
  const existingContents = await readFileSafe(gitignorePath, {
    defaultValue: '',
  });
  const requiredEntries = ['node_modules', '.env', '.vercel', 'dist', '.DS_Store'];
  const existingLines = new Set(
    existingContents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  let nextContents = existingContents;

  for (const entry of requiredEntries) {
    if (!existingLines.has(entry)) {
      nextContents += `${nextContents.endsWith('\n') || nextContents.length === 0 ? '' : '\n'}${entry}\n`;
    }
  }

  if (nextContents !== existingContents) {
    await writeFileSafe(gitignorePath, nextContents);
  }
}

async function ensureRepositoryInitialized(projectPath) {
  const resolvedProjectPath = path.resolve(projectPath);
  const gitDirectory = path.join(resolvedProjectPath, '.git');

  await ensureDirectory(resolvedProjectPath);
  await ensureGitignore(resolvedProjectPath);

  if (!(await fileExists(gitDirectory))) {
    await runGit(['init', '-b', DEFAULT_BRANCH], {
      cwd: resolvedProjectPath,
    });
  }

  await runGit(['config', 'user.name', 'OmniForge Deployment Bot'], {
    cwd: resolvedProjectPath,
  });
  await runGit(['config', 'user.email', 'deployments@omniforge.local'], {
    cwd: resolvedProjectPath,
  });
  await runGit(['checkout', '-B', DEFAULT_BRANCH], {
    cwd: resolvedProjectPath,
  });

  return resolvedProjectPath;
}

async function commitAllChanges(projectPath, message = DEFAULT_COMMIT_MESSAGE) {
  await runGit(['add', '-A'], {
    cwd: projectPath,
  });

  const statusResult = await runGit(['status', '--porcelain'], {
    cwd: projectPath,
  });
  const headResult = await runGit(['rev-parse', '--verify', 'HEAD'], {
    cwd: projectPath,
    allowFailure: true,
  });

  if (statusResult.stdout.length === 0) {
    return {
      createdCommit: false,
      commitSha: headResult.code === 0 ? headResult.stdout : null,
    };
  }

  await runGit(['commit', '-m', message], {
    cwd: projectPath,
  });

  const commitResult = await runGit(['rev-parse', 'HEAD'], {
    cwd: projectPath,
  });

  return {
    createdCommit: true,
    commitSha: commitResult.stdout,
  };
}

async function githubRequest(endpoint, { method = 'GET', body } = {}) {
  const { token } = getGitHubConfig();
  const response = await fetch(`${GITHUB_API_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const rawBody = await response.text();
  let payload = {};

  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const error = new Error(
      payload?.message ?? `GitHub request failed with status ${response.status}.`,
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function normalizeRepository(payload, {
  repoName,
  username,
  created,
}) {
  return {
    repoName,
    owner: username,
    created,
    defaultBranch: payload.default_branch ?? DEFAULT_BRANCH,
    remoteUrl: payload.clone_url ?? `https://github.com/${username}/${repoName}.git`,
    htmlUrl: payload.html_url ?? `https://github.com/${username}/${repoName}`,
    repositoryId: payload.id ?? null,
    isPrivate: Boolean(payload.private),
  };
}

export async function initRepo(projectPath) {
  assertProjectPath(projectPath);

  const resolvedProjectPath = await ensureRepositoryInitialized(projectPath);
  const commit = await commitAllChanges(
    resolvedProjectPath,
    'chore: initialize OmniForge project',
  );

  return {
    projectPath: resolvedProjectPath,
    branch: DEFAULT_BRANCH,
    ...commit,
  };
}

export async function createRepo(repoName) {
  const { username } = getGitHubConfig();
  const normalizedRepoName = sanitizeRepoName(repoName);

  try {
    const payload = await githubRequest('/user/repos', {
      method: 'POST',
      body: {
        name: normalizedRepoName,
        private: true,
        auto_init: false,
      },
    });

    return normalizeRepository(payload, {
      repoName: normalizedRepoName,
      username,
      created: true,
    });
  } catch (error) {
    if (error.status !== 422) {
      throw error;
    }

    const payload = await githubRequest(
      `/repos/${encodeURIComponent(username)}/${encodeURIComponent(normalizedRepoName)}`,
    );

    return normalizeRepository(payload, {
      repoName: normalizedRepoName,
      username,
      created: false,
    });
  }
}

export async function pushRepo(projectPath, repoName) {
  assertProjectPath(projectPath);

  const normalizedRepoName = sanitizeRepoName(repoName);
  const { token, username } = getGitHubConfig();
  const resolvedProjectPath = await ensureRepositoryInitialized(projectPath);
  const repository = await createRepo(normalizedRepoName);
  const commit = await commitAllChanges(resolvedProjectPath);
  const remoteUrl = `https://github.com/${username}/${normalizedRepoName}.git`;
  const authHeader = `AUTHORIZATION: basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
  const existingOrigin = await runGit(['remote', 'get-url', 'origin'], {
    cwd: resolvedProjectPath,
    allowFailure: true,
  });

  if (existingOrigin.code === 0) {
    if (existingOrigin.stdout !== remoteUrl) {
      await runGit(['remote', 'set-url', 'origin', remoteUrl], {
        cwd: resolvedProjectPath,
      });
    }
  } else {
    await runGit(['remote', 'add', 'origin', remoteUrl], {
      cwd: resolvedProjectPath,
    });
  }

  await runGit(
    [
      '-c',
      `http.extraheader=${authHeader}`,
      'push',
      '--set-upstream',
      'origin',
      `${DEFAULT_BRANCH}:${DEFAULT_BRANCH}`,
    ],
    {
      cwd: resolvedProjectPath,
    },
  );

  return {
    projectPath: resolvedProjectPath,
    branch: DEFAULT_BRANCH,
    remoteUrl,
    htmlUrl: repository.htmlUrl,
    repoName: normalizedRepoName,
    ...commit,
  };
}

export default {
  initRepo,
  createRepo,
  pushRepo,
};
