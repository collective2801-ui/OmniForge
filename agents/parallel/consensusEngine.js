const PRIORITIES = Object.freeze([
  'valid_code',
  'secure_code',
  'optimized_output',
]);

function createFileMap(files = []) {
  return new Map(
    (Array.isArray(files) ? files : [])
      .filter((file) => file && typeof file.path === 'string')
      .map((file) => [file.path, file.content]),
  );
}

function detectConflicts(builderFiles = [], optimizerFiles = []) {
  const builderMap = createFileMap(builderFiles);
  const optimizerMap = createFileMap(optimizerFiles);
  const paths = new Set([...builderMap.keys(), ...optimizerMap.keys()]);
  const conflicts = [];

  for (const path of paths) {
    const builderContent = builderMap.get(path);
    const optimizerContent = optimizerMap.get(path);

    if (builderContent === undefined && optimizerContent !== undefined) {
      conflicts.push({
        path,
        type: 'optimizer_added_file',
        resolution: 'accepted_optimizer_file',
      });
      continue;
    }

    if (builderContent !== undefined && optimizerContent === undefined) {
      conflicts.push({
        path,
        type: 'optimizer_removed_file',
        resolution: 'kept_builder_file',
      });
      continue;
    }

    if (builderContent !== optimizerContent) {
      conflicts.push({
        path,
        type: 'content_mismatch',
        resolution: 'prefer_optimizer_if_valid_and_secure',
      });
    }
  }

  return conflicts;
}

function createCandidate(name, files, results, conflicts) {
  const reviewerPassed = results.reviewer?.passed === true;
  const securityPassed = results.security?.passed === true;
  const optimizerPassed = results.optimizer?.passed === true;

  const score =
    (reviewerPassed ? 100 : 0) +
    (securityPassed ? 80 : 0) +
    (name === 'optimizer' && optimizerPassed ? 25 : 0) +
    Math.min(Array.isArray(files) ? files.length : 0, 50) -
    conflicts.length;

  return {
    name,
    files: Array.isArray(files) ? files : [],
    score,
    reviewerPassed,
    securityPassed,
    optimizerPassed,
  };
}

function selectCandidate(results, conflicts) {
  const builderCandidate = createCandidate(
    'builder',
    results.builder?.files,
    results,
    conflicts.filter((conflict) => conflict.type === 'optimizer_removed_file'),
  );
  const optimizerCandidate = createCandidate(
    'optimizer',
    results.optimizer?.files,
    results,
    conflicts,
  );

  if (optimizerCandidate.securityPassed && optimizerCandidate.reviewerPassed) {
    return optimizerCandidate.score >= builderCandidate.score
      ? optimizerCandidate
      : builderCandidate;
  }

  return builderCandidate.score >= optimizerCandidate.score
    ? builderCandidate
    : optimizerCandidate;
}

export function resolveConsensus(results = {}) {
  if (!results || typeof results !== 'object') {
    throw new TypeError('Parallel agent results are required for consensus resolution.');
  }

  if (!results.planner?.plan) {
    throw new TypeError('Consensus resolution requires a planner result with a plan.');
  }

  const conflicts = detectConflicts(
    results.builder?.files ?? [],
    results.optimizer?.files ?? [],
  );
  const selectedCandidate = selectCandidate(results, conflicts);
  const status =
    results.reviewer?.passed === true && results.security?.passed === true
      ? 'success'
      : 'failed';

  return {
    roles: results.roles ?? [],
    plan: results.planner.plan,
    files: selectedCandidate.files,
    status,
    retriesUsed: results.retriesUsed ?? 0,
    diagnostics: {
      reviewer: results.reviewer ?? {
        passed: false,
        issues: ['Reviewer result missing from parallel execution.'],
      },
      optimizer: {
        passed: results.optimizer?.passed ?? false,
        issues: results.optimizer?.issues ?? [],
        fileCount: results.optimizer?.fileCount ?? selectedCandidate.files.length,
      },
      security: results.security ?? {
        passed: false,
        issues: ['Security result missing from parallel execution.'],
      },
      roleLogs: results.roleLogs ?? [],
      consensus: {
        priorities: PRIORITIES,
        selectedSource: selectedCandidate.name,
        selectedScore: selectedCandidate.score,
        conflictCount: conflicts.length,
        conflicts,
      },
    },
    parallel: {
      enabled: true,
      attempts: results.attempts ?? [],
      planner: {
        stepCount: results.planner?.stepCount ?? results.planner?.plan?.steps?.length ?? 0,
      },
      agents: {
        planner: {
          passed: results.planner?.passed ?? true,
        },
        builder: {
          passed: results.builder?.passed ?? false,
          fileCount: results.builder?.fileCount ?? 0,
        },
        reviewer: {
          passed: results.reviewer?.passed ?? false,
          issueCount: results.reviewer?.issues?.length ?? 0,
        },
        optimizer: {
          passed: results.optimizer?.passed ?? false,
          fileCount: results.optimizer?.fileCount ?? 0,
        },
        security: {
          passed: results.security?.passed ?? false,
          issueCount: results.security?.issues?.length ?? 0,
        },
      },
    },
  };
}

export default {
  resolveConsensus,
};
