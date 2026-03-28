import path from 'node:path';
import {
  fileExists,
  readFileSafe,
  updateFileSafe,
  writeJsonSafe,
} from '../engine/fileSystem.js';
import logger from '../engine/logger.js';

const CODE_EXTENSIONS = Object.freeze(['.js', '.jsx', '.ts', '.tsx', '.json']);

function createId(prefix = 'issue') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeIssue(issue) {
  if (!issue || typeof issue !== 'object') {
    throw new TypeError('Runtime issue must be an object.');
  }

  return {
    id: typeof issue.id === 'string' && issue.id.trim().length > 0
      ? issue.id.trim()
      : createId('issue'),
    category: typeof issue.category === 'string' ? issue.category : 'runtime',
    severity: typeof issue.severity === 'string' ? issue.severity : 'error',
    message: typeof issue.message === 'string' ? issue.message : 'Runtime issue detected.',
    filePath: typeof issue.filePath === 'string' ? issue.filePath : null,
    fixable: issue.fixable === true,
    originalSpecifier: typeof issue.originalSpecifier === 'string' ? issue.originalSpecifier : null,
    recommendedSpecifier:
      typeof issue.recommendedSpecifier === 'string' ? issue.recommendedSpecifier : null,
    service: typeof issue.service === 'string' ? issue.service : null,
  };
}

function toImportSpecifier(importingFile, targetFile) {
  const relativePath = path.relative(path.dirname(importingFile), targetFile);
  const normalizedPath = relativePath.split(path.sep).join('/');
  return normalizedPath.startsWith('.') ? normalizedPath : `./${normalizedPath}`;
}

async function loadFileRecord(fileDescriptor = {}, projectRoot = '') {
  const candidatePath =
    typeof fileDescriptor.absolutePath === 'string' && fileDescriptor.absolutePath.trim().length > 0
      ? path.resolve(fileDescriptor.absolutePath.trim())
      : typeof fileDescriptor.path === 'string' && fileDescriptor.path.trim().length > 0 && projectRoot
        ? path.resolve(projectRoot, fileDescriptor.path.trim())
        : null;

  if (!candidatePath || !(await fileExists(candidatePath))) {
    return null;
  }

  const content = await readFileSafe(candidatePath, {
    defaultValue: '',
  });

  return {
    path: typeof fileDescriptor.path === 'string' && fileDescriptor.path.trim().length > 0
      ? fileDescriptor.path.trim()
      : path.relative(projectRoot || path.dirname(candidatePath), candidatePath).split(path.sep).join('/'),
    absolutePath: candidatePath,
    content,
    extension: path.extname(candidatePath).toLowerCase(),
    lineCount: String(content).split(/\r?\n/).length,
    size: Buffer.byteLength(String(content), 'utf8'),
  };
}

async function loadFileRecords(files = [], projectRoot = '') {
  const records = [];

  for (const fileDescriptor of files) {
    const record = await loadFileRecord(fileDescriptor, projectRoot);

    if (record) {
      records.push(record);
    }
  }

  return records;
}

async function resolveImportCandidates(importingFile, specifier) {
  const basePath = path.resolve(path.dirname(importingFile), specifier);
  const candidates = [
    basePath,
    ...CODE_EXTENSIONS.map((extension) => `${basePath}${extension}`),
    ...CODE_EXTENSIONS.map((extension) => path.join(basePath, `index${extension}`)),
  ];
  const matches = [];

  for (const candidatePath of candidates) {
    if (await fileExists(candidatePath)) {
      matches.push(candidatePath);
    }
  }

  return [...new Set(matches)];
}

async function findImportIssues(files = []) {
  const issues = [];
  const importPattern = /\b(?:import|export)\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g;

  for (const file of files) {
    if (!CODE_EXTENSIONS.includes(file.extension) || file.extension === '.json') {
      continue;
    }

    const matches = [...String(file.content).matchAll(importPattern)];

    for (const match of matches) {
      const specifier = match[1];

      if (!specifier.startsWith('.')) {
        continue;
      }

      const resolvedCandidates = await resolveImportCandidates(file.absolutePath, specifier);

      if (resolvedCandidates.length === 0) {
        issues.push({
          id: createId('missing-file'),
          category: 'missing_file',
          severity: 'error',
          fixable: false,
          filePath: file.absolutePath,
          originalSpecifier: specifier,
          message: `Relative import ${specifier} does not resolve from ${file.path}.`,
        });
        continue;
      }

      const specifierHasExplicitExtension = /\.[a-z0-9]+$/i.test(specifier);

      if (!specifierHasExplicitExtension) {
        continue;
      }

      const exactImportTarget = path.resolve(path.dirname(file.absolutePath), specifier);

      if (resolvedCandidates.includes(exactImportTarget)) {
        continue;
      }

      const recommendedSpecifier = toImportSpecifier(file.absolutePath, resolvedCandidates[0]);
      issues.push({
        id: createId('bad-import'),
        category: 'bad_import',
        severity: 'error',
        fixable: true,
        filePath: file.absolutePath,
        originalSpecifier: specifier,
        recommendedSpecifier,
        message: `Import ${specifier} in ${file.path} should resolve to ${recommendedSpecifier}.`,
      });
    }
  }

  return issues;
}

function detectStatusIssues(state = {}) {
  const issues = [];

  if (Array.isArray(state.execution?.stepResults)) {
    for (const stepResult of state.execution.stepResults) {
      if (stepResult.status === 'failed') {
        issues.push({
          id: createId('build'),
          category: 'failed_build',
          severity: 'error',
          service: stepResult.action ?? stepResult.title ?? 'execution',
          fixable: false,
          message: stepResult.summary ?? `${stepResult.title ?? 'Execution step'} failed.`,
        });
      }
    }
  }

  if (state.deployment?.status === 'failed') {
    issues.push({
      id: createId('api'),
      category: 'api_error',
      severity: 'error',
      service: 'deployment',
      fixable: false,
      message: state.deployment.error ?? 'Deployment provider reported a failure.',
    });
  }

  if (state.integrations?.status === 'failed') {
    issues.push({
      id: createId('api'),
      category: 'api_error',
      severity: 'error',
      service: 'integrations',
      fixable: false,
      message: state.integrations.error ?? 'API integration scaffolding failed.',
    });
  }

  if (state.unifiedAPI?.status === 'failed') {
    issues.push({
      id: createId('api'),
      category: 'api_error',
      severity: 'error',
      service: 'unified_api',
      fixable: false,
      message: state.unifiedAPI.error ?? 'Unified API planning failed.',
    });
  }

  if (state.mobile?.status === 'failed') {
    issues.push({
      id: createId('build'),
      category: 'failed_build',
      severity: 'warning',
      service: 'mobile',
      fixable: false,
      message: state.mobile.error ?? 'Mobile build preparation failed.',
    });
  }

  return issues;
}

export function scanSecurity(files = []) {
  const warnings = [];
  const secretRules = [
    {
      id: 'stripe-live-key',
      regex: /sk_live_[A-Za-z0-9]{16,}/g,
      severity: 'error',
      message: 'Detected a live Stripe secret key in source content.',
    },
    {
      id: 'private-key',
      regex: /-----BEGIN (?:RSA|EC|OPENSSH|PRIVATE) KEY-----/g,
      severity: 'error',
      message: 'Detected a private key block in source content.',
    },
    {
      id: 'hardcoded-secret',
      regex: /(?:api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9/_+=.-]{16,}['"]/gi,
      severity: 'warning',
      message: 'Detected a possible hardcoded credential assignment.',
    },
    {
      id: 'dynamic-eval',
      regex: /\beval\s*\(|\bnew Function\s*\(/g,
      severity: 'warning',
      message: 'Detected dynamic code execution that should be reviewed.',
    },
  ];

  for (const file of files) {
    for (const rule of secretRules) {
      if (rule.regex.test(file.content)) {
        warnings.push({
          id: createId('security'),
          category: 'security',
          severity: rule.severity,
          filePath: file.absolutePath,
          message: `${rule.message} File: ${file.path}.`,
        });
      }

      rule.regex.lastIndex = 0;
    }
  }

  return warnings;
}

export function optimizePerformance(files = []) {
  const suggestions = [];

  for (const file of files) {
    if (file.size > 35 * 1024) {
      suggestions.push({
        id: createId('perf'),
        category: 'performance',
        severity: 'warning',
        filePath: file.absolutePath,
        message: `${file.path} is ${file.size} bytes and may benefit from splitting into smaller modules.`,
      });
    }

    if (file.lineCount > 550) {
      suggestions.push({
        id: createId('perf'),
        category: 'performance',
        severity: 'info',
        filePath: file.absolutePath,
        message: `${file.path} has ${file.lineCount} lines and could be simplified for maintainability.`,
      });
    }

    if (/\breadFileSync\b|\bwriteFileSync\b|\bappendFileSync\b/.test(file.content)) {
      suggestions.push({
        id: createId('perf'),
        category: 'performance',
        severity: 'info',
        filePath: file.absolutePath,
        message: `${file.path} uses synchronous file APIs that may affect runtime responsiveness.`,
      });
    }
  }

  return suggestions;
}

async function writeDiagnosticsArtifact(projectRoot, diagnostics) {
  if (typeof projectRoot !== 'string' || projectRoot.trim().length === 0) {
    return [];
  }

  const targetPath = path.join(path.resolve(projectRoot.trim()), 'runtime', 'runtime-diagnostics.json');
  await writeJsonSafe(targetPath, diagnostics);

  return [
    {
      path: 'runtime/runtime-diagnostics.json',
      absolutePath: targetPath,
    },
  ];
}

async function emitProgress(onProgress, type, payload = {}) {
  if (typeof onProgress !== 'function') {
    return;
  }

  await onProgress({
    type,
    payload: {
      ...payload,
      timestamp: new Date().toISOString(),
    },
  });
}

export async function monitorSystem(state = {}) {
  try {
    const projectRoot =
      typeof state.projectRoot === 'string' && state.projectRoot.trim().length > 0
        ? path.resolve(state.projectRoot.trim())
        : '';
    const loadedFiles = await loadFileRecords(state.files ?? [], projectRoot);
    const importIssues = await findImportIssues(loadedFiles);
    const statusIssues = detectStatusIssues(state);
    const issues = [...importIssues, ...statusIssues].map(normalizeIssue);
    const securityWarnings = scanSecurity(loadedFiles);
    const performanceSuggestions = optimizePerformance(loadedFiles);
    const status = issues.some((issue) => issue.severity === 'error') ||
      securityWarnings.some((warning) => warning.severity === 'error')
      ? 'degraded'
      : 'healthy';
    const diagnostics = {
      generatedAt: new Date().toISOString(),
      status,
      issuesFixed: false,
      filesAnalyzed: loadedFiles.length,
      issues,
      securityWarnings,
      performanceSuggestions,
      metrics: {
        issueCount: issues.length,
        securityWarningCount: securityWarnings.length,
        performanceSuggestionCount: performanceSuggestions.length,
      },
      files: [],
    };

    diagnostics.files = await writeDiagnosticsArtifact(projectRoot, {
      ...diagnostics,
      projectRoot,
    });

    if (issues.length > 0) {
      await logger.warn('Runtime monitor detected issues.', {
        projectRoot,
        issueCount: issues.length,
        issues,
      });
    } else {
      await logger.info('Runtime monitor completed without blocking issues.', {
        projectRoot,
        filesAnalyzed: loadedFiles.length,
      });
    }

    if (securityWarnings.length > 0) {
      await logger.warn('Runtime monitor detected security warnings.', {
        projectRoot,
        securityWarningCount: securityWarnings.length,
      });
    }

    await emitProgress(state.onProgress, 'runtime_monitor_completed', diagnostics);
    return diagnostics;
  } catch (error) {
    const failure = {
      generatedAt: new Date().toISOString(),
      status: 'failed',
      issuesFixed: false,
      filesAnalyzed: 0,
      issues: [],
      securityWarnings: [],
      performanceSuggestions: [],
      metrics: {
        issueCount: 0,
        securityWarningCount: 0,
        performanceSuggestionCount: 0,
      },
      files: [],
      error: error?.message ?? 'Unexpected runtime monitor failure.',
    };

    await logger.error('Runtime monitor failed.', {
      error: failure.error,
      projectRoot: state.projectRoot ?? null,
    });
    await emitProgress(state.onProgress, 'runtime_monitor_failed', failure);
    return failure;
  }
}

export async function attemptAutoFix(issue, context = {}) {
  const normalizedIssue = normalizeIssue(issue);

  if (!normalizedIssue.fixable) {
    return {
      issueId: normalizedIssue.id,
      attempted: false,
      fixed: false,
      action: 'Issue is not marked as auto-fixable.',
      files: [],
    };
  }

  try {
    if (
      normalizedIssue.category === 'bad_import' &&
      normalizedIssue.filePath &&
      normalizedIssue.originalSpecifier &&
      normalizedIssue.recommendedSpecifier
    ) {
      const importPattern = new RegExp(
        `(['"])${escapeRegExp(normalizedIssue.originalSpecifier)}\\1`,
        'g',
      );

      await updateFileSafe(normalizedIssue.filePath, (currentContents) =>
        String(currentContents).replace(
          importPattern,
          (match) => match.replace(normalizedIssue.originalSpecifier, normalizedIssue.recommendedSpecifier),
        ));

      const result = {
        issueId: normalizedIssue.id,
        attempted: true,
        fixed: true,
        action: `Updated import ${normalizedIssue.originalSpecifier} to ${normalizedIssue.recommendedSpecifier}.`,
        files: [
          {
            path:
              typeof context.projectRoot === 'string' && context.projectRoot.trim().length > 0
                ? path.relative(path.resolve(context.projectRoot.trim()), normalizedIssue.filePath).split(path.sep).join('/')
                : path.basename(normalizedIssue.filePath),
            absolutePath: normalizedIssue.filePath,
          },
        ],
      };

      await emitProgress(context.onProgress, 'runtime_auto_fix_applied', result);
      return result;
    }

    return {
      issueId: normalizedIssue.id,
      attempted: false,
      fixed: false,
      action: 'No supported auto-fix is available for this issue category.',
      files: [],
    };
  } catch (error) {
    const failure = {
      issueId: normalizedIssue.id,
      attempted: true,
      fixed: false,
      action: error?.message ?? 'Auto-fix failed.',
      files: [],
    };

    await emitProgress(context.onProgress, 'runtime_auto_fix_failed', failure);
    return failure;
  }
}

export default {
  monitorSystem,
  attemptAutoFix,
  scanSecurity,
  optimizePerformance,
};
