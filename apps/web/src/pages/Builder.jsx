import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import PlatformShell from '../components/PlatformShell.jsx';
import PromptBox, { ReferenceOptionGrid } from '../components/PromptBox.jsx';
import { useBuilder } from '../hooks/useBuilder.js';
import OmniForgeInterface, {
  OMNIFORGE_INTERFACE_MODES,
} from '../lib/omniforgeInterface.jsx';
import authClient from '../services/authClient.js';
import { createControlCenter } from '../lib/controlCenter.js';
import {
  isVoiceInputSupported,
  startVoiceInput,
} from '../lib/voiceController.js';

const CODE_KEYWORDS = new Set([
  'import',
  'from',
  'export',
  'default',
  'function',
  'return',
  'const',
  'let',
  'var',
  'if',
  'else',
  'for',
  'while',
  'switch',
  'case',
  'break',
  'continue',
  'try',
  'catch',
  'finally',
  'throw',
  'await',
  'async',
  'class',
  'extends',
  'new',
  'null',
  'true',
  'false',
]);

function inferLanguageFromPath(path = '') {
  const normalizedPath = String(path).toLowerCase();

  if (normalizedPath.endsWith('.jsx') || normalizedPath.endsWith('.tsx')) {
    return 'jsx';
  }

  if (normalizedPath.endsWith('.js') || normalizedPath.endsWith('.ts')) {
    return 'javascript';
  }

  if (normalizedPath.endsWith('.json')) {
    return 'json';
  }

  if (normalizedPath.endsWith('.css')) {
    return 'css';
  }

  if (normalizedPath.endsWith('.sql')) {
    return 'sql';
  }

  if (normalizedPath.endsWith('.html')) {
    return 'html';
  }

  return 'text';
}

function tokenizeLine(line = '', language = 'text') {
  const tokens = [];
  const pattern = /(\/\/.*$|#.*$|"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\b\d+(?:\.\d+)?\b|\b[a-zA-Z_$][a-zA-Z0-9_$-]*\b|[{}()[\].,:;=<>/+*-]+)/g;
  let cursor = 0;

  for (const match of line.matchAll(pattern)) {
    const [value] = match;
    const index = match.index ?? 0;

    if (index > cursor) {
      tokens.push({
        type: 'plain',
        value: line.slice(cursor, index),
      });
    }

    let type = 'plain';

    if (value.startsWith('//') || value.startsWith('#')) {
      type = 'comment';
    } else if (value.startsWith('"') || value.startsWith("'") || value.startsWith('`')) {
      type = 'string';
    } else if (/^\d/.test(value)) {
      type = 'number';
    } else if (CODE_KEYWORDS.has(value)) {
      type = 'keyword';
    } else if (language === 'sql' && /^(select|from|where|join|table|create|insert|update|delete|alter|drop)$/i.test(value)) {
      type = 'keyword';
    } else if (language === 'css' && /^[@.#]/.test(value)) {
      type = 'symbol';
    } else if (/[{}()[\].,:;=<>/+*-]/.test(value)) {
      type = 'symbol';
    } else if (/^[A-Z]/.test(value)) {
      type = 'type';
    }

    tokens.push({
      type,
      value,
    });
    cursor = index + value.length;
  }

  if (cursor < line.length) {
    tokens.push({
      type: 'plain',
      value: line.slice(cursor),
    });
  }

  return tokens;
}

export default function Builder() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('projectId') ?? '';
  const projectName = searchParams.get('projectName') ?? '';
  const seedPrompt = searchParams.get('seedPrompt') ?? '';
  const autorun = searchParams.get('autorun') === '1';
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [previewLinkState, setPreviewLinkState] = useState('');
  const [mobileQrCodeUrl, setMobileQrCodeUrl] = useState('');
  const {
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
    activeFile,
    selectedFilePath,
    databaseSchema,
    selectFile,
    references,
    inputAnalysis,
    referenceBuildOptions,
    selectedBuildOptions,
    selectedBuildOption,
    productReadiness,
    websiteDraft,
    setWebsiteDraft,
    processingReferences,
    addWebsiteReference,
    addUploadedReferences,
    removeReference,
    toggleBuildOption,
    buildFromReferenceOption,
    buildSelectedReferenceOptions,
    runCompletionPass,
    runPrompt,
    publishProject,
  } = useBuilder({
    projectId,
    projectName,
  });
  const voiceControllerRef = useRef(null);
  const seededPromptHandledRef = useRef(false);
  const [activeInterfaceMode, setActiveInterfaceMode] = useState('prompt');
  const [activeCanvasTab, setActiveCanvasTab] = useState('preview');
  const [fileListExpanded, setFileListExpanded] = useState(true);
  const [voiceState, setVoiceState] = useState({
    supported: false,
    listening: false,
    transcript: '',
    error: '',
  });

  useEffect(() => {
    setVoiceState((currentState) => ({
      ...currentState,
      supported: isVoiceInputSupported(),
    }));
  }, []);

  useEffect(() => {
    let active = true;

    async function hydrateBuilderShell() {
      const [userResult, projectsResult] = await Promise.all([
        authClient.getCurrentUser(),
        authClient.getUserProjects(),
      ]);

      if (!active) {
        return;
      }

      if (userResult.ok && userResult.user) {
        setUser(userResult.user);
      }

      if (projectsResult.ok) {
        setProjects(projectsResult.projects ?? []);
      }
    }

    void hydrateBuilderShell();

    return () => {
      active = false;
    };
  }, []);

  async function refreshProjects() {
    const projectsResult = await authClient.getUserProjects();

    if (projectsResult.ok) {
      setProjects(projectsResult.projects ?? []);
    }
  }

  useEffect(() => () => {
    voiceControllerRef.current?.abort?.();
  }, []);

  useEffect(() => {
    if (!seedPrompt || seededPromptHandledRef.current) {
      return;
    }

    seededPromptHandledRef.current = true;
    setPrompt(seedPrompt);

    if (autorun) {
      void runPrompt(seedPrompt, {
        inputMode: 'text',
      });
    }
  }, [autorun, runPrompt, seedPrompt, setPrompt]);

  function handleTextRun(nextPrompt) {
    return runPrompt(nextPrompt, {
      inputMode: 'text',
    });
  }

  async function handlePublish() {
    await publishProject();
  }

  async function handleBuildSelectedOptions() {
    await buildSelectedReferenceOptions();
    await refreshProjects();
  }

  async function handleCopyPreviewLink() {
    const targetUrl = preview.url || deployment?.url || '';

    if (!targetUrl || !navigator?.clipboard?.writeText) {
      return;
    }

    await navigator.clipboard.writeText(targetUrl);
    setPreviewLinkState('Copied');

    window.setTimeout(() => {
      setPreviewLinkState('');
    }, 1400);
  }

  function handleVoiceToggle() {
    if (voiceState.listening) {
      voiceControllerRef.current?.stop?.();
      return;
    }

    setVoiceState((currentState) => ({
      ...currentState,
      supported: isVoiceInputSupported(),
      listening: false,
      transcript: '',
      error: '',
    }));

    voiceControllerRef.current = startVoiceInput({
      interimResults: true,
      onStart() {
        setVoiceState((currentState) => ({
          ...currentState,
          supported: true,
          listening: true,
          error: '',
        }));
      },
      onStateChange(nextState) {
        setVoiceState((currentState) => ({
          ...currentState,
          supported: nextState.supported === true,
          listening: nextState.listening === true,
          transcript: nextState.transcript || currentState.transcript,
        }));
      },
      onError(voiceError) {
        setVoiceState((currentState) => ({
          ...currentState,
          supported: isVoiceInputSupported(),
          listening: false,
          error: voiceError.message,
        }));
      },
      onStop(result) {
        const resolvedTranscript = result.finalTranscript || result.transcript;

        setVoiceState((currentState) => ({
          ...currentState,
          supported: true,
          listening: false,
          transcript: resolvedTranscript || currentState.transcript,
        }));

        if (resolvedTranscript) {
          setPrompt(resolvedTranscript);
          void runPrompt(resolvedTranscript, {
            inputMode: 'voice',
          });
        }
      },
    });
  }

  const controlCenter = useMemo(() => createControlCenter({
    prompt,
    loading,
    status,
    logs,
    architecture,
    uiState: builderUiState,
    voice: voiceState,
    preview,
    finalization,
    deployment,
    domain,
    integrations,
    unifiedAPI,
    runtime,
    mobile,
    store,
  }), [
    architecture,
    builderUiState,
    deployment,
    domain,
    finalization,
    integrations,
    loading,
    logs,
    mobile,
    prompt,
    preview,
    runtime,
    status,
    store,
    unifiedAPI,
    voiceState,
  ]);
  const liveLogPreview = controlCenter.inspector.activityFeed;
  const canPublish = Boolean(
    projectId &&
    !loading &&
    (preview.ready || files.length > 0 || status.generatedFilesCount > 0),
  );
  const filteredProjects = useMemo(() => {
    const normalizedSearch = sidebarSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return projects;
    }

    return projects.filter((project) =>
      [project.name, project.status, project.customDomain, project.liveUrl]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [projects, sidebarSearch]);
  const recentProjects = useMemo(
    () =>
      [...projects]
        .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
        .slice(0, 6),
    [projects],
  );
  const previewAccessUrl = preview.url || deployment?.url || '';
  const finalProductUrl = useMemo(() => {
    if (typeof domain?.domain === 'string' && domain.domain.trim().length > 0) {
      return `https://${domain.domain.trim().replace(/^https?:\/\//, '')}`;
    }

    return previewAccessUrl;
  }, [domain?.domain, previewAccessUrl]);
  const isMobileBuild = Boolean(
    mobile?.status ||
      intent?.projectType === 'mobile_app' ||
      /\b(mobile|ios|iphone|ipad|android|expo|react native|native app)\b/i.test(
        `${intent?.summary ?? ''} ${(intent?.features ?? []).join(' ')}`,
      ),
  );
  const expoLaunchUrl = useMemo(() => {
    const candidates = [
      mobile?.access?.expoGoUrl,
      mobile?.access?.launchUrl,
      mobile?.runtimeConfig?.publicRuntimeEnv?.EXPO_PUBLIC_LAUNCH_URL,
      mobile?.runtimeConfig?.publicRuntimeEnv?.EXPO_GO_URL,
    ];

    return candidates.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
  }, [mobile]);
  const mobileAccessTarget = useMemo(() => {
    if (!isMobileBuild) {
      return '';
    }

    const candidates = [
      expoLaunchUrl,
      finalProductUrl,
      mobile?.access?.qrTarget,
      mobile?.access?.appUrl,
      mobile?.runtimeConfig?.publicRuntimeEnv?.APP_URL,
      mobile?.runtimeConfig?.publicRuntimeEnv?.PUBLIC_APP_URL,
    ];

    return candidates.find((value) => typeof value === 'string' && value.trim().length > 0)?.trim() ?? '';
  }, [expoLaunchUrl, finalProductUrl, isMobileBuild, mobile]);
  const hasNativeExpoLaunch = expoLaunchUrl.startsWith('exp://') || expoLaunchUrl.startsWith('exps://');
  const failedReadinessChecks = productReadiness.checks.filter((check) => check.state === 'failed');
  const canRunCompletionPass = !loading && failedReadinessChecks.length > 0;
  const modeCopy = {
    prompt: {
      title: 'Prompt Build',
      summary: 'Describe the product and run the build.',
    },
    website: {
      title: 'Analyze Website',
      summary: 'Paste a website address and choose a build direction.',
    },
    upload: {
      title: 'Upload & Build',
      summary: 'Upload source material and build from the selected direction.',
    },
  };
  const currentModeCopy = modeCopy[activeInterfaceMode] ?? modeCopy.prompt;
  const recentActivity = [...logs].slice(-8).reverse();

  useEffect(() => {
    let active = true;

    if (!mobileAccessTarget) {
      setMobileQrCodeUrl('');
      return () => {
        active = false;
      };
    }

    void QRCode.toDataURL(mobileAccessTarget, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 240,
      color: {
        dark: '#0b1120',
        light: '#f8fafc',
      },
    })
      .then((value) => {
        if (active) {
          setMobileQrCodeUrl(value);
        }
      })
      .catch(() => {
        if (active) {
          setMobileQrCodeUrl('');
        }
      });

    return () => {
      active = false;
    };
  }, [mobileAccessTarget]);

  const sidebarSections = useMemo(
    () => [
      {
        id: 'recent',
        label: 'Recent',
        count: recentProjects.length,
        defaultOpen: true,
        emptyMessage: 'No recent workspaces yet.',
        items: recentProjects.map((project) => ({
          key: `recent-${project.id}`,
          to: `/projects/${encodeURIComponent(project.id)}`,
          label: project.name,
          description: project.liveUrl || project.customDomain || project.status || 'draft',
          badge: project.liveUrl ? 'live' : project.status || 'draft',
        })),
      },
      {
        id: 'projects',
        label: 'Projects',
        count: filteredProjects.length,
        defaultOpen: false,
        control: (
          <input
            className="dashboard-input platform-sidebar__search"
            onChange={(event) => setSidebarSearch(event.target.value)}
            placeholder="Search projects"
            type="search"
            value={sidebarSearch}
          />
        ),
        emptyMessage: loading ? 'Loading workspaces…' : 'No matching projects.',
        items: filteredProjects.map((project) => ({
          key: project.id,
          to: `/projects/${encodeURIComponent(project.id)}`,
          label: project.name,
          description: project.status || 'draft',
          badge: project.liveUrl ? 'live' : project.status || 'draft',
        })),
      },
    ],
    [filteredProjects, loading, recentProjects, sidebarSearch],
  );
  const commandPaletteItems = useMemo(() => {
    const projectCommands = filteredProjects.slice(0, 6).map((project) => ({
      id: `project-${project.id}`,
      label: `Open ${project.name}`,
      description: project.liveUrl || project.customDomain || project.status || 'Open workspace',
      keywords: [project.name, 'project', 'workspace', project.status ?? ''],
      onSelect() {
        navigate(`/projects/${encodeURIComponent(project.id)}`);
      },
    }));

    return [
      {
        id: 'build-prompt',
        label: 'Build app from prompt',
        description: 'Switch to prompt mode and start a direct build.',
        keywords: ['prompt', 'build', 'app'],
        shortcut: '⌘1',
        onSelect() {
          setActiveInterfaceMode('prompt');
        },
      },
      {
        id: 'analyze-url',
        label: 'Analyze website',
        description: 'Switch to website analysis mode for source-driven builds.',
        keywords: ['website', 'url', 'analyze'],
        shortcut: '⌘2',
        onSelect() {
          setActiveInterfaceMode('website');
        },
      },
      {
        id: 'upload-build',
        label: 'Upload and build',
        description: 'Switch to upload mode and turn files into a working product.',
        keywords: ['upload', 'file', 'build'],
        shortcut: '⌘3',
        onSelect() {
          setActiveInterfaceMode('upload');
        },
      },
      {
        id: 'open-preview',
        label: 'Open preview',
        description: 'Focus the central canvas on the rendered product.',
        keywords: ['preview', 'canvas', 'render'],
        onSelect() {
          setActiveCanvasTab('preview');
        },
      },
      {
        id: 'open-code',
        label: 'Open code',
        description: 'Inspect generated files in the central canvas.',
        keywords: ['code', 'files', 'editor'],
        onSelect() {
          setActiveCanvasTab('code');
        },
      },
      {
        id: 'open-database',
        label: 'Open database',
        description: 'Inspect the inferred schema and generated SQL.',
        keywords: ['database', 'schema', 'sql'],
        onSelect() {
          setActiveCanvasTab('database');
        },
      },
      {
        id: 'open-delivery',
        label: 'Open live preview',
        description: 'Open the current live preview in a new tab.',
        keywords: ['preview', 'live', 'open'],
        onSelect() {
          if (previewAccessUrl) {
            window.open(previewAccessUrl, '_blank', 'noopener,noreferrer');
          }
        },
      },
      {
        id: 'publish-project',
        label: 'Publish current project',
        description: canPublish
          ? 'Deploy the current project and return the live URL.'
          : 'Publishing becomes available once the current build produces files or a preview.',
        keywords: ['publish', 'deploy', 'live'],
        onSelect() {
          if (canPublish) {
            void handlePublish();
          }
        },
      },
      ...projectCommands,
    ];
  }, [canPublish, filteredProjects, handlePublish, navigate, previewAccessUrl]);
  const interfaceActions = (
    <>
      {previewAccessUrl ? (
        <a
          className="platform-action platform-action--link"
          href={previewAccessUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open Live
        </a>
      ) : null}
      <button
        className="prompt-submit"
        disabled={!canPublish}
        onClick={() => void handlePublish()}
        type="button"
      >
        {loading ? 'Publishing…' : 'Publish'}
      </button>
    </>
  );
  const leftPanel = (
    <div className="studio-thread-stack">
      <section className="panel studio-chat-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Build Thread</p>
            <h2 className="panel-title">Build thread</h2>
          </div>
          <span className={`panel-badge ${loading ? 'panel-badge--running' : ''}`}>
            {loading ? 'Live' : 'Ready'}
          </span>
        </div>
        <div className="studio-chat-panel__body">
          {inputAnalysis ? (
            <article className="omniforge-analysis-card studio-chat-bubble studio-chat-bubble--analysis">
              <strong>{inputAnalysis.sourceLabel}</strong>
              <p>{inputAnalysis.summary}</p>
              <div className="prompt-hints">
                {(inputAnalysis.features ?? []).slice(0, 4).map((feature) => (
                  <span className="prompt-hint" key={feature}>{feature}</span>
                ))}
              </div>
            </article>
          ) : null}

          {selectedBuildOptions.length > 0 ? (
            <article className="omniforge-analysis-card studio-chat-bubble studio-chat-bubble--selected">
              <strong>
                {selectedBuildOptions.length === 1 ? 'Selected direction' : 'Selected directions'}
              </strong>
              <div className="prompt-hints">
                {selectedBuildOptions.map((option) => (
                  <span className="prompt-hint" key={option.id}>
                    {option.name || option.title}
                  </span>
                ))}
              </div>
              {selectedBuildOption ? (
                <p>{selectedBuildOption.description || selectedBuildOption.summary}</p>
              ) : null}
            </article>
          ) : null}

          <div className="studio-chat-stream">
            {recentActivity.length > 0 ? (
              recentActivity.map((entry) => (
                <article
                  className={`studio-chat-bubble studio-chat-bubble--${entry.level === 'error' ? 'error' : 'system'}`}
                  key={entry.id}
                >
                  <span>{entry.stage}</span>
                  <p>{entry.message}</p>
                </article>
              ))
            ) : (
              <div className="control-empty">
                Build activity will appear here after the first run.
              </div>
            )}
          </div>
        </div>
      </section>

      <PromptBox
        mode={activeInterfaceMode}
        prompt={prompt}
        loading={loading}
        processingReferences={processingReferences}
        references={references}
        referenceBuildOptions={referenceBuildOptions}
        selectedBuildOptions={selectedBuildOptions}
        selectedBuildOption={selectedBuildOption}
        websiteDraft={websiteDraft}
        onPromptChange={setPrompt}
        onWebsiteDraftChange={setWebsiteDraft}
        onAddWebsite={addWebsiteReference}
        onFilesSelected={addUploadedReferences}
        onRemoveReference={removeReference}
        onToggleReferenceOption={toggleBuildOption}
        onUseReferenceOption={buildFromReferenceOption}
        onBuildSelectedOptions={handleBuildSelectedOptions}
        onSubmit={handleTextRun}
        onVoiceToggle={handleVoiceToggle}
        voice={voiceState}
        showBuildOptions={false}
      />
    </div>
  );
  const centerPanel = (
    <section className="panel studio-canvas-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{projectName || currentModeCopy.title}</p>
          <h2 className="panel-title">{activeCanvasTab === 'preview' ? preview.title : activeCanvasTab === 'code' ? 'Generated Code' : 'Database'}</h2>
        </div>
        <div className="workspace-tabs">
          <button
            className={`workspace-tab ${activeCanvasTab === 'preview' ? 'workspace-tab--active' : ''}`}
            onClick={() => setActiveCanvasTab('preview')}
            type="button"
          >
            Preview
          </button>
          <button
            className={`workspace-tab ${activeCanvasTab === 'code' ? 'workspace-tab--active' : ''}`}
            onClick={() => setActiveCanvasTab('code')}
            type="button"
          >
            Code
          </button>
          <button
            className={`workspace-tab ${activeCanvasTab === 'database' ? 'workspace-tab--active' : ''}`}
            onClick={() => setActiveCanvasTab('database')}
            type="button"
          >
            Database
          </button>
        </div>
      </div>

      <div className="studio-canvas-panel__body">
        <div className="builder-canvas-status">
          <span>{loading ? controlCenter.progress.currentStageLabel : 'Ready'}</span>
          <strong>{loading ? `${controlCenter.progress.percent}%` : (preview.ready ? 'Live preview ready' : currentModeCopy.summary)}</strong>
        </div>

        {activeCanvasTab === 'preview' ? (
          <div className="builder-preview-toolbar">
            <div className="builder-preview-toolbar__address">
              {previewAccessUrl || 'Preview will appear here after the build starts.'}
            </div>
            <div className="product-preview__actions">
              {preview.url ? (
                <>
                  <a
                    className="panel-badge"
                    href={preview.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Open
                  </a>
                  <button
                    className="platform-action platform-action--muted"
                    onClick={() => void handleCopyPreviewLink()}
                    type="button"
                  >
                    {previewLinkState || 'Copy'}
                  </button>
                </>
              ) : (
                <button
                  className="platform-action platform-action--muted"
                  disabled={!canPublish}
                  onClick={() => void handlePublish()}
                  type="button"
                >
                  Publish
                </button>
              )}
            </div>
          </div>
        ) : null}

        {activeCanvasTab === 'preview' ? (
          <div className="builder-preview-layout">
            <div className="builder-preview-stage">
              <div className="builder-device-shell">
                <div className="builder-device-shell__camera" />
                <div className="builder-device-shell__screen">
                  {preview.ready ? (
                    preview.mode === 'live' ? (
                      <iframe
                        className="product-preview__frame"
                        loading="lazy"
                        src={preview.url}
                        title={preview.title}
                      />
                    ) : (
                      <iframe
                        className="product-preview__frame"
                        loading="lazy"
                        sandbox="allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-scripts"
                        srcDoc={preview.srcDoc}
                        title={preview.title}
                      />
                    )
                  ) : (
                    <div className={`product-preview product-preview--empty ${loading ? 'product-preview--skeleton' : ''}`}>
                      {loading ? (
                        <div className="omniforge-preview-skeleton" aria-hidden="true">
                          <span className="omniforge-preview-skeleton__bar omniforge-preview-skeleton__bar--hero" />
                          <span className="omniforge-preview-skeleton__bar" />
                          <span className="omniforge-preview-skeleton__bar omniforge-preview-skeleton__bar--short" />
                          <div className="omniforge-preview-skeleton__grid">
                            <span />
                            <span />
                            <span />
                          </div>
                        </div>
                      ) : null}
                      <p>{loading ? 'OmniForge is still generating the preview.' : preview.summary}</p>
                    </div>
                  )}
                </div>
                <div className="builder-device-shell__home-indicator" />
              </div>
            </div>

            <aside className="builder-preview-sidebar">
              <section className="builder-sidecard builder-sidecard--deploy">
                <div className="builder-sidecard__top">
                  <div>
                    <p className="panel-kicker">Deploy</p>
                    <h3 className="panel-title">Production readiness</h3>
                  </div>
                  <span className={`panel-badge ${productReadiness.ready ? '' : 'panel-badge--running'}`}>
                    {productReadiness.ready ? 'Ready' : failedReadinessChecks.length > 0 ? 'Needs fixes' : 'Pending'}
                  </span>
                </div>

                <div className="builder-readiness-score">
                  <strong>{productReadiness.score}/{productReadiness.total}</strong>
                  <span>
                    {productReadiness.ready
                      ? 'All completion gates passed.'
                      : failedReadinessChecks.length > 0
                        ? 'Completion gates are still open.'
                        : 'Run a build to evaluate readiness.'}
                  </span>
                </div>

                <div className="builder-readiness-checklist">
                  {productReadiness.checks.map((check) => (
                    <article
                      className={`builder-readiness-check builder-readiness-check--${check.state}`}
                      key={check.id}
                    >
                      <div className="builder-readiness-check__top">
                        <strong>{check.label}</strong>
                        <span>
                          {check.state === 'passed' ? 'Pass' : check.state === 'failed' ? 'Fix' : 'Pending'}
                        </span>
                      </div>
                      <p>{check.detail}</p>
                    </article>
                  ))}
                </div>

                {productReadiness.missingFiles.length > 0 ? (
                  <div className="builder-readiness-missing">
                    <span>Missing files</span>
                    <ul>
                      {productReadiness.missingFiles.map((filePath) => (
                        <li key={filePath}>{filePath}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="builder-sidecard__actions">
                  <button
                    className="platform-action platform-action--muted"
                    disabled={!canPublish}
                    onClick={() => void handlePublish()}
                    type="button"
                  >
                    {loading ? 'Publishing…' : 'Publish'}
                  </button>
                  <button
                    className="prompt-submit prompt-submit--compact"
                    disabled={!canRunCompletionPass}
                    onClick={() => void runCompletionPass()}
                    type="button"
                  >
                    Run completion pass
                  </button>
                </div>
              </section>

              <section className="builder-sidecard builder-sidecard--access">
                <div className="builder-sidecard__top">
                  <div>
                    <p className="panel-kicker">Access</p>
                    <h3 className="panel-title">Finished product</h3>
                  </div>
                  <span className="panel-badge">
                    {finalProductUrl ? 'Live' : isMobileBuild ? 'Mobile build' : 'Pending'}
                  </span>
                </div>

                {finalProductUrl ? (
                  <div className="builder-access-link">
                    <span className="builder-access-link__label">
                      {isMobileBuild ? 'Web companion URL' : 'Live product URL'}
                    </span>
                    <a
                      className="builder-access-link__url"
                      href={finalProductUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {finalProductUrl}
                    </a>
                  </div>
                ) : (
                  <p className="builder-access-empty">
                    Run a production build to generate a public access URL for the finished product.
                  </p>
                )}

                {isMobileBuild ? (
                  mobileAccessTarget ? (
                    <div className="builder-mobile-qr">
                      <div className="builder-mobile-qr__frame">
                        {mobileQrCodeUrl ? (
                          <img
                            alt={hasNativeExpoLaunch ? 'Expo Go launch QR code' : 'Mobile access QR code'}
                            className="builder-mobile-qr__image"
                            src={mobileQrCodeUrl}
                          />
                        ) : (
                          <div className="builder-mobile-qr__loading">Generating QR…</div>
                        )}
                      </div>
                      <div className="builder-mobile-qr__caption">
                        <strong>{hasNativeExpoLaunch ? 'Expo Go launch' : 'Mobile access'}</strong>
                        <span>
                          {hasNativeExpoLaunch
                            ? 'Scan this with Expo Go to open the generated mobile build.'
                            : 'Scan this with your phone to open the finished mobile product while native packages are prepared.'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="builder-access-empty">
                      The mobile scaffold is ready, but a launch URL is not available yet. Publish or run a completion pass to finish access delivery.
                    </p>
                  )
                ) : null}

                <div className="builder-sidecard__actions">
                  {finalProductUrl ? (
                    <a
                      className="platform-action platform-action--link"
                      href={finalProductUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open product
                    </a>
                  ) : null}
                  {mobileAccessTarget ? (
                    <a
                      className="platform-action platform-action--muted"
                      href={mobileAccessTarget}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {hasNativeExpoLaunch ? 'Open Expo launch' : 'Open mobile access'}
                    </a>
                  ) : null}
                </div>
              </section>
            </aside>
          </div>
        ) : null}

        {activeCanvasTab === 'preview' && referenceBuildOptions.length > 0 ? (
          <section className="builder-idea-stage">
            <div className="builder-idea-stage__header">
              <div>
                <p className="panel-kicker">App Ideas</p>
                <h3 className="panel-title">Choose one or two finished products to build</h3>
                <p className="builder-idea-stage__summary">
                  Each concept includes its promised features and projected cash-flow impact. Select up to two and build them.
                </p>
              </div>
            </div>

            <ReferenceOptionGrid
              loading={loading}
              onBuildSelectedOptions={handleBuildSelectedOptions}
              onToggleReferenceOption={toggleBuildOption}
              onUseReferenceOption={buildFromReferenceOption}
              processingReferences={processingReferences}
              referenceBuildOptions={referenceBuildOptions}
              selectedBuildOptions={selectedBuildOptions}
            />
          </section>
        ) : null}

        {activeCanvasTab === 'code' ? (
          <section className="studio-code-panel">
            <button
              className="omniforge-collapse-toggle"
              onClick={() => setFileListExpanded((current) => !current)}
              type="button"
            >
              <span>{fileListExpanded ? 'Hide file explorer' : 'Show file explorer'}</span>
              <strong>{files.length} files</strong>
            </button>

            <div className={`studio-code-panel__body ${fileListExpanded ? 'studio-code-panel__body--open' : ''}`}>
              <div className="studio-code-panel__list">
                {files.length > 0 ? (
                  files.map((file) => (
                    <button
                      className={`omniforge-file-list__item ${file.path === selectedFilePath ? 'omniforge-file-list__item--active' : ''}`}
                      key={file.path}
                      onClick={() => selectFile(file.path)}
                      type="button"
                    >
                      <strong>{file.path}</strong>
                      <span>{file.content.split('\n').length} lines</span>
                    </button>
                  ))
                ) : (
                  <div className="control-empty">
                    Generated files will appear here after the build finishes.
                  </div>
                )}
              </div>

              <div className="studio-code-panel__preview">
                {activeFile ? (
                  <>
                    <div className="file-preview__header">
                      <span className="file-preview__path">{activeFile.path}</span>
                      <span className="file-preview__meta">{activeFile.content.length} characters</span>
                    </div>
                    <pre className={`file-code file-code--${inferLanguageFromPath(activeFile.path)}`}>
                      <code className="file-code__content">
                        {activeFile.content.split('\n').map((line, lineIndex) => (
                          <span className="file-code__line" key={`${activeFile.path}-${lineIndex + 1}`}>
                            <span className="file-code__line-number">{lineIndex + 1}</span>
                            <span className="file-code__line-content">
                              {tokenizeLine(line, inferLanguageFromPath(activeFile.path)).map((token, tokenIndex) => (
                                <span
                                  className={`file-token file-token--${token.type}`}
                                  key={`${activeFile.path}-${lineIndex + 1}-${tokenIndex}`}
                                >
                                  {token.value}
                                </span>
                              ))}
                            </span>
                          </span>
                        ))}
                      </code>
                    </pre>
                  </>
                ) : (
                  <div className="control-empty">
                    Select a generated file to inspect it.
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {activeCanvasTab === 'database' ? (
          <section className="studio-database-panel">
            <div className="panel-header">
              <div>
                <p className="panel-kicker">Database Schema</p>
                <h2 className="panel-title">{databaseSchema?.path || 'database/schema.sql'}</h2>
              </div>
              <span className="panel-badge">{databaseSchema ? 'Ready' : 'Pending'}</span>
            </div>

            {databaseSchema ? (
              <>
                {Array.isArray(inputAnalysis?.features) && inputAnalysis.features.length > 0 ? (
                  <div className="prompt-hints">
                    {inputAnalysis.features.slice(0, 6).map((feature) => (
                      <span className="prompt-hint" key={`db-${feature}`}>{feature}</span>
                    ))}
                  </div>
                ) : null}
                <pre className="file-code">
                  <code>{databaseSchema.content}</code>
                </pre>
              </>
            ) : (
              <div className="control-empty">
                No database schema has been generated yet.
              </div>
            )}
          </section>
        ) : null}
      </div>
    </section>
  );

  return (
    <div className="builder-shell">
      <div className="builder-backdrop" />
      <div className="builder-glow builder-glow--blue" />
      <div className="builder-glow builder-glow--green" />
      <div className="builder-glow builder-glow--purple" />
      <div className="builder-glow builder-glow--pink" />

      <PlatformShell
        headerMode="hidden"
        project={projectId ? { id: projectId, name: projectName } : null}
        sidebarSections={sidebarSections}
        user={user}
      >
        {error ? (
          <div className="error-banner" role="alert">
            <strong>Execution Error</strong>
            <span>{error}</span>
          </div>
        ) : null}
        <OmniForgeInterface
          activeMode={activeInterfaceMode}
          actions={interfaceActions}
          centerPanel={centerPanel}
          commandPalette={{
            title: 'Jump instantly through OmniForge',
            items: commandPaletteItems,
            placeholder: 'Build app, analyze URL, open project…',
          }}
          leftPanel={leftPanel}
          minimalChrome
          modes={OMNIFORGE_INTERFACE_MODES}
          onModeChange={setActiveInterfaceMode}
          subtitle=""
          title={projectName || 'Build'}
        />
      </PlatformShell>
    </div>
  );
}
