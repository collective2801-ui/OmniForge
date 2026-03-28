import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PlatformShell from '../components/PlatformShell.jsx';
import PromptBox from '../components/PromptBox.jsx';
import SystemConsole from '../components/SystemConsole.jsx';
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
  } = useBuilder({
    projectId,
    projectName,
  });
  const voiceControllerRef = useRef(null);
  const seededPromptHandledRef = useRef(false);
  const previousLoadingRef = useRef(false);
  const [activeInterfaceMode, setActiveInterfaceMode] = useState('prompt');
  const [activeCanvasTab, setActiveCanvasTab] = useState('preview');
  const [fileListExpanded, setFileListExpanded] = useState(true);
  const [expandedInspectorSections, setExpandedInspectorSections] = useState({
    activity: false,
    delivery: false,
    system: false,
    integrations: false,
    mobile: false,
  });
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

    Promise.all([
      authClient.getCurrentUser(),
      authClient.getUserProjects(),
    ]).then(([userResult, projectsResult]) => {
      if (!active) {
        return;
      }

      if (userResult.ok && userResult.user) {
        setUser(userResult.user);
      }

      if (projectsResult.ok) {
        setProjects(projectsResult.projects ?? []);
      }
    });

    return () => {
      active = false;
    };
  }, []);

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

  useEffect(() => {
    if (previousLoadingRef.current && !loading) {
      setExpandedInspectorSections({
        activity: false,
        delivery: false,
        system: false,
        integrations: false,
        mobile: false,
      });
    }

    previousLoadingRef.current = loading;
  }, [loading]);

  function handleTextRun(nextPrompt) {
    return runPrompt(nextPrompt, {
      inputMode: 'text',
    });
  }

  async function handlePublish() {
    setExpandedInspectorSections((currentSections) => ({
      ...currentSections,
      delivery: true,
    }));
    await publishProject();
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

  function toggleInspectorSection(sectionId) {
    setExpandedInspectorSections((currentSections) => ({
      ...currentSections,
      [sectionId]: !currentSections[sectionId],
    }));
  }

  function openInspectorSection(sectionId) {
    setExpandedInspectorSections((currentSections) => ({
      ...currentSections,
      [sectionId]: true,
    }));
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
  const interfaceStatusMeta = controlCenter.progress;
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
  const modeCopy = {
    prompt: {
      title: 'Prompt Build',
      summary: 'Describe the product, then let OmniForge build and validate it.',
    },
    website: {
      title: 'Analyze Website',
      summary: 'Paste a website, review four generated directions, then build the best one.',
    },
    upload: {
      title: 'Upload & Build',
      summary: 'Upload source material, choose one of the generated directions, and ship it.',
    },
  };
  const currentModeCopy = modeCopy[activeInterfaceMode] ?? modeCopy.prompt;
  const recentActivity = [...logs].slice(-8).reverse();
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
        label: 'Open delivery details',
        description: 'Expand publish and domain details in the inspector.',
        keywords: ['delivery', 'publish', 'domain'],
        onSelect() {
          openInspectorSection('delivery');
        },
      },
      {
        id: 'open-activity-log',
        label: 'Open activity log',
        description: 'Expand the full execution log in the inspector.',
        keywords: ['activity', 'logs', 'console'],
        onSelect() {
          openInspectorSection('activity');
        },
      },
      {
        id: 'open-system',
        label: 'Open system details',
        description: 'Expand runtime and architecture details in the inspector.',
        keywords: ['system', 'runtime', 'architecture'],
        onSelect() {
          openInspectorSection('system');
        },
      },
      {
        id: 'open-integrations',
        label: 'Open integration details',
        description: 'Expand provider and API details in the inspector.',
        keywords: ['integrations', 'api', 'providers'],
        onSelect() {
          openInspectorSection('integrations');
        },
      },
      {
        id: 'open-mobile',
        label: 'Open mobile details',
        description: 'Expand mobile and app-store outputs in the inspector.',
        keywords: ['mobile', 'store', 'expo'],
        onSelect() {
          openInspectorSection('mobile');
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
  }, [canPublish, filteredProjects, handlePublish, navigate, openInspectorSection]);
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
      {projectId ? (
        <Link
          className="platform-action platform-action--link"
          to={`/projects/${encodeURIComponent(projectId)}`}
        >
          Workspace
        </Link>
      ) : null}
      <Link className="platform-action platform-action--link" to="/dashboard">
        Home
      </Link>
    </>
  );
  const leftPanel = (
    <>
      <section className="panel studio-chat-panel">
        <div className="panel-header">
          <div>
            <p className="panel-kicker">Build Thread</p>
            <h2 className="panel-title">Conversation + source context</h2>
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
        onSubmit={handleTextRun}
        onVoiceToggle={handleVoiceToggle}
        voice={voiceState}
      />
    </>
  );
  const centerPanel = (
    <section className="panel studio-canvas-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">{currentModeCopy.title}</p>
          <h2 className="panel-title">{preview.title}</h2>
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
        <div className={`omniforge-execution-ribbon ${loading ? 'omniforge-execution-ribbon--active' : ''}`}>
          <div className="omniforge-execution-ribbon__copy">
            <span className="panel-kicker">Execution Pulse</span>
            <strong>{controlCenter.progress.headline}</strong>
            <p>{currentModeCopy.summary}</p>
          </div>
          <div className="omniforge-execution-ribbon__meta">
            <span>{controlCenter.progress.currentStageLabel}</span>
            <strong>{controlCenter.progress.percent}%</strong>
          </div>
          <div className="omniforge-execution-ribbon__progress">
            <span style={{ width: `${controlCenter.progress.percent}%` }} />
          </div>
          <div className="omniforge-execution-ribbon__stages">
            {controlCenter.progress.rail.map((stage) => (
              <article
                className={`omniforge-execution-ribbon__stage omniforge-execution-ribbon__stage--${stage.status} omniforge-execution-ribbon__stage--${stage.accent}`}
                key={stage.id}
              >
                <span>{stage.label}</span>
                <strong>{stage.indicator}</strong>
              </article>
            ))}
          </div>
        </div>

        <div className="studio-canvas-meta">
          <div className="builder-command-bar__badges">
            <span className="panel-badge">
              {lastInputMode === 'voice' ? 'Voice input' : 'Text input'}
            </span>
            <span className="panel-badge">
              {preview.ready ? (preview.url ? 'Live preview' : 'Sandbox preview') : 'Preview pending'}
            </span>
            {inputAnalysis?.type ? <span className="panel-badge">{inputAnalysis.type}</span> : null}
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
                  Open Live App
                </a>
                <button
                  className="platform-action"
                  onClick={() => void handleCopyPreviewLink()}
                  type="button"
                >
                  {previewLinkState || 'Copy Link'}
                </button>
              </>
            ) : (
              <button
                className="platform-action"
                disabled={!canPublish}
                onClick={() => void handlePublish()}
                type="button"
              >
                Publish Project
              </button>
            )}
          </div>
        </div>

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
                        sandbox=""
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

            <div className="builder-preview-sidebar">
              <article className="builder-sidecard">
                <div className="builder-sidecard__top">
                  <strong>Preview route</strong>
                  <span className="panel-badge">{preview.ready ? 'active' : 'idle'}</span>
                </div>
                <p>{previewAccessUrl || preview.summary}</p>
              </article>

              <article className="builder-sidecard">
                <div className="builder-sidecard__top">
                  <strong>Source mode</strong>
                  <span className="panel-badge">{currentModeCopy.title}</span>
                </div>
                <p>{currentModeCopy.summary}</p>
              </article>

              {selectedBuildOptions.length > 0 ? (
                <article className="builder-sidecard">
                  <div className="builder-sidecard__top">
                    <strong>
                      {selectedBuildOptions.length === 1 ? 'Selected direction' : 'Selected directions'}
                    </strong>
                    <span className="panel-badge">source build</span>
                  </div>
                  <p>{selectedBuildOptions.map((option) => option.name || option.title).join(' • ')}</p>
                </article>
              ) : null}
            </div>
          </div>
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
  const rightPanel = (
    <section className="panel studio-inspector-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Inspector</p>
          <h2 className="panel-title">Focused build state</h2>
        </div>
        <span className={`panel-badge ${loading ? 'panel-badge--running' : ''}`}>
          {controlCenter.inspector.progressLabel}
        </span>
      </div>

      <div className="studio-inspector-panel__body">
        <article
          className={`thinking-panel thinking-panel--compact ${
            loading ? 'thinking-panel--active' : ''
          }`}
        >
          <div className="thinking-panel__header">
            <div>
              <p className="panel-kicker">Current state</p>
              <h3 className="panel-title">{controlCenter.inspector.headline}</h3>
            </div>
            <span className="panel-badge">{controlCenter.inspector.stageLabel}</span>
          </div>
          <p className="thinking-panel__summary">{controlCenter.inspector.summary}</p>
          {loading ? (
            <>
              <div className="thinking-progress">
                <span
                  className={`thinking-progress__bar ${controlCenter.thinking.pulse ? 'thinking-progress__bar--active' : ''}`}
                  style={{ width: `${controlCenter.thinking.progress}%` }}
                />
              </div>
              <div className="omniforge-flow-lines" aria-hidden="true">
                {controlCenter.thinking.ambientLines.map((line) => (
                  <span
                    className={`omniforge-flow-lines__segment ${line.active ? 'omniforge-flow-lines__segment--active' : ''} ${line.complete ? 'omniforge-flow-lines__segment--complete' : ''} omniforge-flow-lines__segment--${line.accent}`}
                    key={line.id}
                  />
                ))}
              </div>
            </>
          ) : null}
        </article>

        {(loading || error) && liveLogPreview.length > 0 ? (
          <div className="omniforge-live-feed">
            {liveLogPreview.map((entry) => (
              <article className={`omniforge-live-feed__item omniforge-live-feed__item--${entry.tone}`} key={entry.id}>
                <span>{entry.stageLabel}</span>
                <p>{entry.shortMessage}</p>
              </article>
            ))}
          </div>
        ) : null}

        <div className="studio-status-stack">
          {controlCenter.inspector.primaryCards.map((card) => (
            <article className={`live-signal-card live-signal-card--${card.tone}`} key={card.label}>
              <div className="live-signal-card__top">
                <span>{card.label}</span>
                <strong>{card.value}</strong>
              </div>
              <p>{card.detail}</p>
            </article>
          ))}
        </div>

        {controlCenter.inspector.sections.map((section) => {
          const isExpanded = expandedInspectorSections[section.id] === true;

          return (
            <section className="inspector-disclosure" key={section.id}>
              <button
                aria-expanded={isExpanded}
                className="inspector-disclosure__toggle"
                onClick={() => toggleInspectorSection(section.id)}
                type="button"
              >
                <div>
                  <strong>{section.label}</strong>
                  <span>{section.summary}</span>
                </div>
                <span className="panel-badge">{isExpanded ? 'Hide' : 'Show'}</span>
              </button>

              {isExpanded ? (
                <div className="inspector-disclosure__body">
                  {section.items.map((card) => (
                    <article className={`live-signal-card live-signal-card--${card.tone ?? 'neutral'}`} key={`${section.id}-${card.label}-${card.value}`}>
                      <div className="live-signal-card__top">
                        <span>{card.label}</span>
                        <strong>{card.value}</strong>
                      </div>
                      <p>{card.detail}</p>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          );
        })}

        {(logs.length > 0 || loading) ? (
          <section className="inspector-disclosure">
            <button
              aria-expanded={expandedInspectorSections.activity === true}
              className="inspector-disclosure__toggle"
              onClick={() => toggleInspectorSection('activity')}
              type="button"
            >
              <div>
                <strong>Activity log</strong>
                <span>Open the full execution stream only when you need it.</span>
              </div>
              <span className="panel-badge">
                {expandedInspectorSections.activity === true ? 'Hide' : 'Show'}
              </span>
            </button>

            {expandedInspectorSections.activity === true ? (
              <div className="inspector-disclosure__body">
                <SystemConsole loading={loading} logs={logs} />
              </div>
            ) : null}
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
          modes={OMNIFORGE_INTERFACE_MODES}
          onModeChange={setActiveInterfaceMode}
          rightPanel={rightPanel}
          statusMeta={interfaceStatusMeta}
          subtitle="Build, inspect, and publish from one focused AI workspace."
          title={projectName || 'OmniForge Studio'}
        />
      </PlatformShell>
    </div>
  );
}
