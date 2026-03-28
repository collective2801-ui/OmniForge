import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { generateBuildOptions } from '../lib/buildOptionsEngine.js';
import { analyzeInput } from '../lib/inputAnalyzer.js';
import {
  createInitialSystemStatus,
  runTask,
} from '../services/orchestratorClient.js';
import {
  analyzeUploadedFiles,
  createBuilderContext,
  createWebsiteReference,
  revokeReferencePreview,
} from '../services/referenceAnalyzer.js';

const DEFAULT_PROMPT = 'build a modern landing page with auth and dashboard';

function createUiLog(level, stage, message) {
  return {
    id: `ui-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    level,
    stage,
    message,
    timestamp: new Date().toISOString(),
  };
}

function buildPreviewState({ deployment, files, intent }) {
  const liveUrl =
    typeof deployment?.url === 'string' && deployment.url.trim().length > 0
      ? deployment.url.trim()
      : '';
  const previewFile = Array.isArray(files)
    ? files.find((file) => file.path === 'preview/index.html')
    : null;
  const projectName =
    typeof intent?.projectName === 'string' && intent.projectName.trim().length > 0
      ? intent.projectName.trim()
      : 'Generated Product';

  if (liveUrl) {
    return {
      ready: true,
      mode: 'live',
      title: `${projectName} live preview`,
      summary: 'Live deployment available now.',
      url: liveUrl,
      srcDoc: '',
    };
  }

  if (typeof previewFile?.content === 'string' && previewFile.content.trim().length > 0) {
    return {
      ready: true,
      mode: 'sandbox',
      title: `${projectName} rendered preview`,
      summary: 'Local preview generated from the current build artifacts.',
      url: '',
      srcDoc: previewFile.content,
    };
  }

  return {
    ready: false,
    mode: 'empty',
    title: `${projectName} preview`,
    summary: 'Run a build to generate a product preview.',
    url: '',
    srcDoc: '',
  };
}

export function useBuilder(projectContext = {}) {
  const initialProjectName =
    typeof projectContext.projectName === 'string' && projectContext.projectName.trim().length > 0
      ? projectContext.projectName.trim()
      : null;
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([
    createUiLog(
      'info',
      'console',
      'Console ready. Submit a product prompt to start the live builder.',
    ),
  ]);
  const [files, setFiles] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(
    createInitialSystemStatus({
      projectName: initialProjectName,
    }),
  );
  const [intent, setIntent] = useState(null);
  const [architecture, setArchitecture] = useState(null);
  const [builderUiState, setBuilderUiState] = useState(null);
  const [finalization, setFinalization] = useState(null);
  const [integrations, setIntegrations] = useState(null);
  const [deployment, setDeployment] = useState(null);
  const [domain, setDomain] = useState(null);
  const [mobile, setMobile] = useState(null);
  const [store, setStore] = useState(null);
  const [unifiedAPI, setUnifiedAPI] = useState(null);
  const [runtime, setRuntime] = useState(null);
  const [business, setBusiness] = useState(null);
  const [growth, setGrowth] = useState(null);
  const [autonomous, setAutonomous] = useState(false);
  const [lastInputMode, setLastInputMode] = useState('text');
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [references, setReferences] = useState([]);
  const [websiteDraft, setWebsiteDraft] = useState('');
  const [processingReferences, setProcessingReferences] = useState(false);
  const [inputAnalysis, setInputAnalysis] = useState(null);
  const [selectedBuildOptions, setSelectedBuildOptions] = useState([]);
  const referencesRef = useRef([]);

  useEffect(() => {
    referencesRef.current = references;
  }, [references]);

  useEffect(() => {
    if (!initialProjectName) {
      return;
    }

    setStatus((currentStatus) => ({
      ...currentStatus,
      projectName: initialProjectName,
      updatedAt: new Date().toISOString(),
    }));
  }, [initialProjectName]);

  useEffect(() => () => {
    referencesRef.current.forEach((reference) => {
      revokeReferencePreview(reference);
    });
  }, []);

  function mergeReferences(currentReferences, nextReferences) {
    const seen = new Set();
    const merged = [];

    for (const reference of [...currentReferences, ...nextReferences]) {
      if (!reference || typeof reference !== 'object') {
        continue;
      }

      const key =
        reference.type === 'website'
          ? reference.url
          : `${reference.name}:${reference.size}:${reference.mimeType}`;

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      merged.push(reference);
    }

    return merged;
  }

  async function addWebsiteReference(rawValue) {
    const normalizedValue = typeof rawValue === 'string' ? rawValue.trim() : '';

    if (!normalizedValue) {
      return null;
    }

    try {
      const nextReference = createWebsiteReference(normalizedValue);
      const nextReferences = mergeReferences(referencesRef.current, [nextReference]);
      setProcessingReferences(true);
      setError('');
      referencesRef.current = nextReferences;

      startTransition(() => {
        setReferences(nextReferences);
        setWebsiteDraft('');
        setLogs((currentLogs) => [
          ...currentLogs,
          createUiLog('info', 'console', `Queued website reference: ${nextReference.url}`),
        ]);
      });

      const analysis = await analyzeInput({
        mode: 'website',
        references: nextReferences,
      });
      const options = generateBuildOptions(analysis);

      startTransition(() => {
        setInputAnalysis(analysis);
        setSelectedBuildOptions([]);
        setLogs((currentLogs) => [
          ...currentLogs,
          createUiLog(
            'info',
            'console',
            `Website analyzed. Generated ${options.length} build option${options.length === 1 ? '' : 's'}.`,
          ),
        ]);
      });

      return nextReference;
    } catch (referenceError) {
      const message =
        referenceError instanceof Error
          ? referenceError.message
          : 'Unable to add website reference.';

      setError(message);
      startTransition(() => {
        setLogs((currentLogs) => [
          ...currentLogs,
          createUiLog('error', 'console', message),
        ]);
      });
      return null;
    } finally {
      setProcessingReferences(false);
    }
  }

  async function addUploadedReferences(fileList) {
    if (!fileList || fileList.length === 0) {
      return [];
    }

    setProcessingReferences(true);

    try {
      const nextReferences = await analyzeUploadedFiles(fileList);
      const mergedReferences = mergeReferences(referencesRef.current, nextReferences);
      setError('');
      referencesRef.current = mergedReferences;

      startTransition(() => {
        setReferences(mergedReferences);
        setLogs((currentLogs) => [
          ...currentLogs,
          createUiLog(
            'info',
            'console',
            `Queued ${nextReferences.length} uploaded reference${nextReferences.length === 1 ? '' : 's'} for analysis.`,
          ),
        ]);
      });

      const analysis = await analyzeInput({
        mode: 'upload',
        references: mergedReferences,
      });
      const options = generateBuildOptions(analysis);

      startTransition(() => {
        setInputAnalysis(analysis);
        setSelectedBuildOptions([]);
        setLogs((currentLogs) => [
          ...currentLogs,
          createUiLog(
            'info',
            'console',
            `Uploads analyzed. Generated ${options.length} build option${options.length === 1 ? '' : 's'}.`,
          ),
        ]);
      });

      return nextReferences;
    } catch (referenceError) {
      const message =
        referenceError instanceof Error
          ? referenceError.message
          : 'Unable to analyze uploaded references.';

      setError(message);
      startTransition(() => {
        setLogs((currentLogs) => [
          ...currentLogs,
          createUiLog('error', 'console', message),
        ]);
      });
      return [];
    } finally {
      setProcessingReferences(false);
    }
  }

  function removeReference(referenceId) {
    const nextReferences = referencesRef.current.filter((reference) => reference.id !== referenceId);
    const targetReference = referencesRef.current.find((reference) => reference.id === referenceId);

    if (targetReference) {
      revokeReferencePreview(targetReference);
    }

    referencesRef.current = nextReferences;
    setReferences(nextReferences);

    if (nextReferences.length === 0) {
      setInputAnalysis(null);
      setSelectedBuildOptions([]);
      return;
    }

    void analyzeInput({
      mode: 'mixed',
      references: nextReferences,
    }).then((analysis) => {
      startTransition(() => {
        setInputAnalysis(analysis);
      });
    });
  }

  async function publishProject() {
    const resolvedProjectName =
      initialProjectName ||
      intent?.projectName ||
      projectContext.projectName ||
      'the current project';

    return runPrompt(
      `publish and deploy ${resolvedProjectName} to production, keep the existing generated app intact, and return the live URL`,
      {
        inputMode: 'text',
      },
    );
  }

  async function runPrompt(nextPrompt = prompt, runOptions = {}) {
    const taskPrompt = typeof nextPrompt === 'string' ? nextPrompt : prompt;
    const normalizedPrompt = taskPrompt.trim();
    const inputMode = runOptions.inputMode === 'voice' ? 'voice' : 'text';
    const builderContext = createBuilderContext(referencesRef.current);
    const runMode = runOptions.mode === 'analyze' ? 'analyze' : 'prompt';

    if (!normalizedPrompt) {
      setError('Prompt cannot be empty.');
      startTransition(() => {
        setLogs((currentLogs) => [
          ...currentLogs,
          createUiLog('error', 'console', 'Prompt validation failed: empty input.'),
        ]);
      });
      return null;
    }

    setLoading(true);
    setError('');
    setLastInputMode(inputMode);

    startTransition(() => {
      setFiles([]);
      setIntent(null);
      setArchitecture(null);
      setBuilderUiState(null);
      setFinalization(null);
      setIntegrations(null);
      setDeployment(null);
      setDomain(null);
      setMobile(null);
      setStore(null);
      setUnifiedAPI(null);
      setRuntime(null);
      setBusiness(null);
      setGrowth(null);
      setAutonomous(false);
      setSelectedBuildOptions(
        Array.isArray(runOptions.selectedOptions)
          ? runOptions.selectedOptions
          : runOptions.selectedOption
            ? [runOptions.selectedOption]
            : [],
      );
      setSelectedFilePath('');
      setLogs([
        createUiLog(
          'info',
          'console',
          inputMode === 'voice'
            ? 'Voice command captured. Streaming execution events…'
            : runMode === 'analyze'
              ? 'Source analysis locked. Streaming build execution events…'
              : 'Live session created. Streaming execution events…',
        ),
      ]);
      setStatus(
        createInitialSystemStatus({
          projectName: initialProjectName,
          orchestrator: {
            state: 'executing',
            detail: 'Preparing the live orchestration bridge for a new task.',
          },
          lastTask: {
            state: 'running',
            detail: 'Task accepted by the builder UI.',
          },
          updatedAt: new Date().toISOString(),
        }),
      );
    });

    try {
      const result = await runTask(normalizedPrompt, {
        projectId: projectContext.projectId ?? null,
        projectName: initialProjectName,
        inputMode,
        builderContext,
        mode: runMode,
        analysis: runOptions.analysis ?? null,
        selectedOption: runOptions.selectedOption ?? null,
        onEvent(event) {
          if (event.type === 'log') {
            startTransition(() => {
              setLogs((currentLogs) => [...currentLogs, event.payload]);
            });
            return;
          }

          if (event.type === 'status') {
            startTransition(() => {
              setStatus(event.payload);
            });
            return;
          }

          if (event.type === 'files') {
            startTransition(() => {
              setFiles(event.payload);
              setSelectedFilePath((currentPath) => currentPath || event.payload[0]?.path || '');
            });
          }
        },
      });

      startTransition(() => {
        setIntent(result.intent);
        setArchitecture(result.architecture ?? null);
        setBuilderUiState(result.uiState ?? null);
        setFinalization(result.finalization ?? null);
        setIntegrations(result.integrations ?? null);
        setDeployment(result.deployment ?? null);
        setDomain(result.domain ?? null);
        setMobile(result.mobile ?? null);
        setStore(result.store ?? null);
        setUnifiedAPI(result.unifiedAPI ?? null);
        setRuntime(result.runtime ?? null);
        setBusiness(result.business ?? null);
        setGrowth(result.growth ?? null);
        setAutonomous(result.autonomous === true);
        setInputAnalysis(result.analysis ?? inputAnalysis);
        setSelectedBuildOptions(
          Array.isArray(result.selectedOptions)
            ? result.selectedOptions
            : result.selectedOption
              ? [result.selectedOption]
              : Array.isArray(runOptions.selectedOptions)
                ? runOptions.selectedOptions
                : runOptions.selectedOption
                  ? [runOptions.selectedOption]
                  : [],
        );
        setFiles(result.generatedFiles);
        setSelectedFilePath((currentPath) => currentPath || result.generatedFiles[0]?.path || '');
        setStatus(result.status);
        setLogs(result.logs);
      });

      return result;
    } catch (runError) {
      const message =
        runError instanceof Error ? runError.message : 'Unknown builder failure.';

      setError(message);

      startTransition(() => {
        setLogs((currentLogs) => [
          ...currentLogs,
          createUiLog('error', 'console', message),
        ]);
        setStatus((currentStatus) => ({
          ...currentStatus,
          orchestrator: {
            state: 'error',
            detail: 'Execution aborted before delivery completed.',
          },
          lastTask: {
            state: 'failed',
            detail: message,
          },
          updatedAt: new Date().toISOString(),
        }));
      });

      return null;
    } finally {
      setLoading(false);
    }
  }

  function selectFile(path) {
    setSelectedFilePath(path);
  }

  async function buildFromReferenceOption(option) {
    if (!option || typeof option.prompt !== 'string') {
      return null;
    }

    const resolvedPrompt = option.prompt;

    setPrompt(resolvedPrompt);
    return runPrompt(resolvedPrompt, {
      inputMode: 'text',
      mode: 'analyze',
      analysis: inputAnalysis,
      selectedOptions: [option],
      selectedOption: option,
    });
  }

  function toggleBuildOption(option) {
    if (!option || typeof option !== 'object') {
      return;
    }

    setSelectedBuildOptions((currentSelected) => {
      if (currentSelected.includes(option)) {
        return currentSelected.filter((selectedOption) => selectedOption !== option);
      }

      if (currentSelected.length < 2) {
        return [...currentSelected, option];
      }

      return currentSelected;
    });
  }

  const activeFile =
    files.find((file) => file.path === selectedFilePath) ?? files[0] ?? null;
  const databaseSchema =
    files.find((file) => file.path === 'database/schema.sql') ?? null;
  const preview = buildPreviewState({
    deployment,
    files,
    intent,
  });
  const referenceBuildOptions = useMemo(
    () => generateBuildOptions(inputAnalysis),
    [inputAnalysis],
  );
  const selectedBuildOption = selectedBuildOptions[selectedBuildOptions.length - 1] ?? null;

  return {
    prompt,
    setPrompt,
    loading,
    logs,
    files,
    error,
    status,
    intent,
    architecture,
    builderUiState,
    finalization,
    integrations,
    deployment,
    domain,
    mobile,
    store,
    unifiedAPI,
    runtime,
    business,
    growth,
    autonomous,
    preview,
    lastInputMode,
    selectedFilePath,
    activeFile,
    databaseSchema,
    selectFile,
    references,
    inputAnalysis,
    referenceBuildOptions,
    selectedBuildOptions,
    selectedBuildOption,
    websiteDraft,
    setWebsiteDraft,
    processingReferences,
    addWebsiteReference,
    addUploadedReferences,
    removeReference,
    toggleBuildOption,
    buildFromReferenceOption,
    runPrompt,
    publishProject,
  };
}

export default useBuilder;
