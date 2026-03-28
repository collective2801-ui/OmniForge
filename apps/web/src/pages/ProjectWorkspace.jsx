import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import FileViewer from '../components/FileViewer.jsx';
import PlatformShell from '../components/PlatformShell.jsx';
import SystemStatus from '../components/SystemStatus.jsx';
import authClient from '../services/authClient.js';

const WORKSPACE_PIPELINE = [
  {
    id: 'reasoning',
    label: 'Reasoning',
    accent: 'blue',
    description: 'Intent and product assumptions were resolved.',
  },
  {
    id: 'generation',
    label: 'Generation',
    accent: 'pink',
    description: 'Application files, preview output, and integrations were prepared.',
  },
  {
    id: 'validation',
    label: 'Validation',
    accent: 'green',
    description: 'Finalization, runtime checks, and deployment metadata were recorded.',
  },
];

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return 'Not available';
  }

  return new Date(timestamp).toLocaleString();
}

function createWorkspaceStatus(workspace) {
  const project = workspace?.project ?? {};
  const runtimeStatus = workspace?.runtime?.diagnostics?.status ?? project.runtimeStatus ?? 'ready';
  const statusState =
    project.status === 'failed' || runtimeStatus === 'error'
      ? 'error'
      : project.status === 'draft'
        ? 'idle'
        : 'completed';

  return {
    engine: {
      state: 'ready',
      detail: 'Project workspace is loaded from the persistent OmniForge runtime.',
    },
    memory: {
      state: 'synced',
      detail: 'Project files, delivery metadata, and runtime artifacts are available.',
    },
    orchestrator: {
      state: statusState,
      detail:
        statusState === 'error'
          ? 'The last recorded run finished with issues that need attention.'
          : 'This workspace is ready for review, editing, or another build pass.',
    },
    lastTask: {
      state: statusState === 'idle' ? 'idle' : statusState,
      detail:
        project.status === 'draft'
          ? 'No build has been executed for this project yet.'
          : `Latest recorded project state: ${project.status || 'ready'}.`,
    },
    pipeline: WORKSPACE_PIPELINE.map((stage) => ({
      ...stage,
      state:
        statusState === 'error'
          ? stage.id === 'validation'
            ? 'error'
            : 'complete'
          : project.status === 'draft'
            ? 'pending'
            : 'complete',
    })),
    projectName: project.name || 'Project workspace',
    routeCategory: 'workspace',
    generatedFilesCount: workspace?.files?.length ?? 0,
    updatedAt: project.updatedAt || new Date().toISOString(),
  };
}

function createDeliveryState(workspace) {
  const project = workspace?.project ?? {};
  const finalization = workspace?.runtime?.finalization ?? null;
  const diagnostics = workspace?.runtime?.diagnostics ?? null;

  return {
    integrations:
      Array.isArray(project.integrations) && project.integrations.length > 0
        ? {
            status: 'configured',
            integrations: project.integrations,
            envKeys: project.integrationEnvKeys ?? [],
            providers: project.integrationProviders ?? {},
          }
        : null,
    finalization,
    deployment:
      project.liveUrl || project.deploymentProvider
        ? {
            status: project.status === 'deployment_failed' ? 'failed' : 'deployed',
            url: project.liveUrl || '',
            provider: project.deploymentProvider || '',
          }
        : null,
    domain:
      project.customDomain || project.domainProvider
        ? {
            status: project.domainStatus || (project.customDomain ? 'ready' : 'idle'),
            domain: project.customDomain || '',
            provider: project.domainProvider || '',
          }
        : null,
    mobile:
      Array.isArray(project.mobilePlatforms) && project.mobilePlatforms.length > 0
        ? {
            status: project.mobileStatus || 'ready',
            platforms: project.mobilePlatforms,
            androidPackage: project.androidPackage || '',
            iosBundleIdentifier: project.iosBundleIdentifier || '',
          }
        : null,
    store:
      project.storeSubmissionReady
        ? {
            status: 'ready',
            submissionReady: true,
            platforms: ['ios', 'android'],
          }
        : null,
    unifiedAPI:
      Array.isArray(project.unifiedApis) && project.unifiedApis.length > 0
        ? {
            status: 'configured',
            apis: project.unifiedApis,
            providers: project.unifiedApiProviders ?? {},
          }
        : null,
    runtime:
      diagnostics || project.runtimeStatus
        ? {
            status: diagnostics?.status || project.runtimeStatus || 'ready',
            issuesFixed: project.runtimeIssuesFixed === true,
            issueCount:
              diagnostics?.metrics?.issueCount ?? project.runtimeIssueCount ?? 0,
            securityWarningCount:
              diagnostics?.metrics?.securityWarningCount ??
              project.runtimeSecurityWarningCount ??
              0,
          }
        : null,
    autonomous: project.autonomous === true,
  };
}

export default function ProjectWorkspace() {
  const navigate = useNavigate();
  const { projectId = '' } = useParams();
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [activeTab, setActiveTab] = useState('preview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [sidebarSearch, setSidebarSearch] = useState('');

  async function loadWorkspace() {
    setLoading(true);
    setError('');

    const [userResult, projectsResult, workspaceResult] = await Promise.all([
      authClient.getCurrentUser(),
      authClient.getUserProjects(),
      authClient.getProjectWorkspace(projectId),
    ]);

    if (!userResult.ok || !userResult.user) {
      navigate('/login', { replace: true });
      return;
    }

    setUser(userResult.user);
    setProjects(projectsResult.ok ? projectsResult.projects ?? [] : []);

    if (!workspaceResult.ok || !workspaceResult.workspace) {
      setWorkspace(null);
      setError(workspaceResult.error?.message ?? 'Unable to load this project workspace.');
      setLoading(false);
      return;
    }

    setWorkspace(workspaceResult.workspace);
    setSelectedFilePath((currentPath) => currentPath || workspaceResult.workspace.files?.[0]?.path || '');
    setLoading(false);
  }

  useEffect(() => {
    void loadWorkspace();
  }, [projectId]);

  async function handleSignOut() {
    await authClient.signOut();
    navigate('/login', { replace: true });
  }

  const codeFiles = useMemo(
    () => (Array.isArray(workspace?.files) ? workspace.files : []),
    [workspace],
  );
  const activeFile =
    codeFiles.find((file) => file.path === selectedFilePath) ?? codeFiles[0] ?? null;
  const preview = workspace?.preview ?? {
    ready: false,
    mode: 'empty',
    url: '',
    html: '',
    title: 'No preview available',
    summary: 'Run a build to generate a preview.',
  };
  const database = workspace?.database ?? {
    path: 'database/schema.sql',
    content: '',
    tables: [],
  };
  const project = workspace?.project ?? null;
  const status = createWorkspaceStatus(workspace);
  const delivery = createDeliveryState(workspace);
  const filteredProjects = useMemo(() => {
    const normalizedSearch = sidebarSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return projects;
    }

    return projects.filter((entry) =>
      [entry.name, entry.status, entry.customDomain, entry.liveUrl]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch),
    );
  }, [projects, sidebarSearch]);
  const sidebarSections = useMemo(
    () => [
      {
        id: 'projects',
        label: 'Projects',
        count: filteredProjects.length,
        defaultOpen: true,
        control: (
          <input
            className="dashboard-input platform-sidebar__search"
            onChange={(event) => setSidebarSearch(event.target.value)}
            placeholder="Search workspaces"
            type="search"
            value={sidebarSearch}
          />
        ),
        emptyMessage: loading
          ? 'Loading your projects…'
          : 'No matching workspaces yet.',
        items: filteredProjects.map((entry) => ({
          key: entry.id,
          to: `/projects/${encodeURIComponent(entry.id)}`,
          label: entry.name,
          description: entry.status || 'draft',
          badge: entry.liveUrl ? 'live' : entry.status || 'draft',
        })),
      },
    ],
    [filteredProjects, loading, sidebarSearch],
  );

  return (
    <div className="builder-shell">
      <div className="builder-backdrop" />
      <div className="builder-glow builder-glow--blue" />
      <div className="builder-glow builder-glow--green" />
      <div className="builder-glow builder-glow--purple" />
      <div className="builder-glow builder-glow--pink" />

      <PlatformShell
        actions={(
          <>
            <button className="platform-action" onClick={() => void loadWorkspace()} type="button">
              Refresh
            </button>
            {project && !project.liveUrl ? (
              <Link
                className="prompt-submit"
                to={`/builder?projectId=${encodeURIComponent(project.id)}&projectName=${encodeURIComponent(project.name)}`}
              >
                Publish
              </Link>
            ) : null}
            {project ? (
              <Link
                className="platform-action platform-action--link"
                to={`/builder?projectId=${encodeURIComponent(project.id)}&projectName=${encodeURIComponent(project.name)}`}
              >
                Continue Building
              </Link>
            ) : null}
            <button className="platform-action" onClick={handleSignOut} type="button">
              Sign Out
            </button>
          </>
        )}
        description="Preview, inspect, and continue shipping from one workspace."
        eyebrow="Project Workspace"
        headerMode="compact"
        project={project}
        sidebarSections={sidebarSections}
        title={project?.name || 'Loading project'}
        user={user}
      >
        {error ? (
          <div className="error-banner" role="alert">
            <strong>Workspace Error</strong>
            <span>{error}</span>
          </div>
        ) : null}

        <section className="panel workspace-tabs-panel">
          <div className="panel-header">
            <div>
              <p className="panel-kicker">Editor</p>
              <h2 className="panel-title">
                {project?.status || 'draft'} · {formatTimestamp(project?.updatedAt)}
              </h2>
            </div>
            <div className="workspace-tabs">
              {['preview', 'code', 'database', 'activity'].map((tab) => (
                <button
                  className={`workspace-tab ${activeTab === tab ? 'workspace-tab--active' : ''}`}
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  type="button"
                >
                  {tab === 'preview'
                    ? 'Preview'
                    : tab === 'code'
                      ? 'Code'
                      : tab === 'database'
                        ? 'Database'
                        : 'Activity'}
                </button>
              ))}
            </div>
          </div>

          <div className="workspace-tabs__body">
            {activeTab === 'preview' ? (
              <section className="panel workspace-panel preview-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-kicker">Rendered Product</p>
                    <h2 className="panel-title">{preview.title}</h2>
                  </div>
                  {preview.url ? (
                    <a
                      className="panel-badge"
                      href={preview.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Open Live App
                    </a>
                  ) : null}
                </div>

                {preview.ready ? (
                  <div className="product-preview">
                    <p className="product-preview__summary">{preview.summary}</p>
                    {preview.url ? (
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
                        srcDoc={preview.html}
                        title={preview.title}
                      />
                    )}
                  </div>
                ) : (
                  <div className="product-preview product-preview--empty">
                    <p>{preview.summary}</p>
                  </div>
                )}
              </section>
            ) : activeTab === 'code' ? (
              <FileViewer
                activeFile={activeFile}
                files={codeFiles}
                onSelect={setSelectedFilePath}
                selectedPath={selectedFilePath}
              />
            ) : activeTab === 'database' ? (
              <section className="panel workspace-panel database-panel">
                <div className="panel-header">
                  <div>
                    <p className="panel-kicker">Database Schema</p>
                    <h2 className="panel-title">{database.path}</h2>
                  </div>
                  <span className="panel-badge">{database.tables?.length ?? 0} tables</span>
                </div>

                <div className="database-panel__body">
                  {Array.isArray(database.tables) && database.tables.length > 0 ? (
                    <div className="intent-ribbon">
                      {database.tables.map((table) => (
                        <span className="intent-pill intent-pill--feature" key={table}>
                          {table}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  {database.content ? (
                    <pre className="file-code">
                      <code>{database.content}</code>
                    </pre>
                  ) : (
                    <div className="control-empty">
                      No database schema has been generated for this project yet.
                    </div>
                  )}
                </div>
              </section>
            ) : (
              <SystemStatus
                delivery={delivery}
                intent={workspace?.intent ?? null}
                loading={loading}
                status={status}
              />
            )}
          </div>
        </section>
      </PlatformShell>
    </div>
  );
}
