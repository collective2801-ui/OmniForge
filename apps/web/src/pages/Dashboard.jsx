import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PlatformShell from '../components/PlatformShell.jsx';
import authClient from '../services/authClient.js';
import billingClient from '../services/billingClient.js';

const BUILD_MODES = [
  {
    id: 'full-stack',
    label: 'Full Stack App',
    promptPrefix: 'build a full-stack SaaS product',
  },
  {
    id: 'mobile',
    label: 'Mobile App',
    promptPrefix: 'build a mobile app with Expo',
  },
  {
    id: 'website',
    label: 'Website',
    promptPrefix: 'build a modern website',
  },
];

const QUICK_STARTS = [
  'Build a SaaS dashboard with auth, payments, and admin analytics',
  'Create a mobile client portal with uploads, progress tracking, and alerts',
  'Build a client rewards app for treatment attendance and consistent screenings',
  'Analyze a website and turn it into a fully working software product',
];

function formatTimestamp(timestamp) {
  if (!timestamp) {
    return 'Not available';
  }

  return new Date(timestamp).toLocaleString();
}

function buildPromptForMode(rawPrompt, modeId) {
  const normalizedPrompt = String(rawPrompt || '').trim();

  if (!normalizedPrompt) {
    return '';
  }

  if (modeId === 'mobile' && !/\bmobile|ios|android|expo\b/i.test(normalizedPrompt)) {
    return `build a mobile app with Expo: ${normalizedPrompt}`;
  }

  if (modeId === 'website' && !/\bwebsite|landing page|marketing site|homepage\b/i.test(normalizedPrompt)) {
    return `build a modern website: ${normalizedPrompt}`;
  }

  if (modeId === 'full-stack' && !/\bsaas|app|dashboard|platform\b/i.test(normalizedPrompt)) {
    return `build a full-stack SaaS app: ${normalizedPrompt}`;
  }

  return normalizedPrompt;
}

function deriveProjectName(rawPrompt, modeId) {
  const normalizedPrompt = String(rawPrompt || '')
    .replace(/\b(build|create|launch|me|a|an|the|with|for|that|app|website|mobile)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const fallback =
    modeId === 'mobile'
      ? 'Mobile Product'
      : modeId === 'website'
        ? 'Launch Website'
        : 'New SaaS Product';

  if (!normalizedPrompt) {
    return fallback;
  }

  return normalizedPrompt
    .split(' ')
    .slice(0, 4)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [search, setSearch] = useState('');
  const [launchPrompt, setLaunchPrompt] = useState('');
  const [buildMode, setBuildMode] = useState('full-stack');
  const [error, setError] = useState('');
  const [billing, setBilling] = useState({
    configured: false,
    plans: [],
    subscription: {
      plan: 'free',
      status: 'inactive',
    },
  });
  async function loadDashboardState() {
    setLoading(true);
    setError('');

    const [userResult, projectsResult, billingResult] = await Promise.all([
      authClient.getCurrentUser(),
      authClient.getUserProjects(),
      billingClient.getBillingOverview(),
    ]);

    if (!userResult.ok || !userResult.user) {
      navigate('/login', { replace: true });
      return;
    }

    setUser(userResult.user);

    if (!projectsResult.ok) {
      setProjects([]);
      setError(projectsResult.error?.message ?? 'Unable to load projects.');
      setLoading(false);
      return;
    }

    setProjects(projectsResult.projects ?? []);

    if (billingResult.ok) {
      setBilling({
        configured: billingResult.configured,
        plans: billingResult.plans ?? [],
        subscription: billingResult.subscription ?? {
          plan: 'free',
          status: 'inactive',
        },
      });
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadDashboardState();
  }, []);

  async function handleCreateProject() {
    const resolvedPrompt = buildPromptForMode(launchPrompt, buildMode);
    const resolvedName = draftName.trim() || deriveProjectName(resolvedPrompt, buildMode);

    if (!resolvedPrompt) {
      setError('Describe what OmniForge should build before launching a project.');
      return;
    }

    setCreating(true);
    setError('');

    const result = await authClient.createProject({
      name: resolvedName,
      path: '',
    });

    setCreating(false);

    if (!result.ok || !result.project) {
      setError(result.error?.message ?? 'Unable to create a new project.');
      return;
    }

    setProjects((currentProjects) => [result.project, ...currentProjects]);
    setDraftName('');
    setLaunchPrompt('');
    navigate(
      `/builder?projectId=${encodeURIComponent(result.project.id)}&projectName=${encodeURIComponent(result.project.name)}&seedPrompt=${encodeURIComponent(resolvedPrompt)}&autorun=1`,
    );
  }

  async function handleSignOut() {
    await authClient.signOut();
    navigate('/login', { replace: true });
  }

  const filteredProjects = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) {
      return projects;
    }

    return projects.filter((project) => {
      const haystack = [
        project.name,
        project.status,
        project.projectType,
        project.customDomain,
        project.liveUrl,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [projects, search]);
  const recentProjects = useMemo(
    () => [...projects].sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt)).slice(0, 4),
    [projects],
  );
  const sidebarSections = useMemo(
    () => [
      {
        id: 'recent',
        label: 'Recent',
        count: recentProjects.length,
        defaultOpen: true,
        emptyMessage: loading ? 'Loading your recent work…' : 'No recent projects yet.',
        items: recentProjects.map((project) => ({
          key: `recent-${project.id}`,
          to: `/projects/${encodeURIComponent(project.id)}`,
          label: project.name,
          description: project.liveUrl || project.customDomain || formatTimestamp(project.updatedAt),
          badge: project.liveUrl ? 'live' : project.status || 'draft',
        })),
      },
      {
        id: 'projects',
        label: 'All Projects',
        count: filteredProjects.length,
        defaultOpen: false,
        control: (
          <input
            className="dashboard-input platform-sidebar__search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search projects, status, domain, or URL"
            type="search"
            value={search}
          />
        ),
        emptyMessage: loading
          ? 'Loading your projects…'
          : 'No projects match this search yet.',
        items: filteredProjects.map((project) => ({
          key: project.id,
          to: `/projects/${encodeURIComponent(project.id)}`,
          label: project.name,
          description: `${project.status || 'draft'} · ${formatTimestamp(project.updatedAt)}`,
          badge: project.liveUrl ? 'live' : project.status || 'draft',
        })),
      },
    ],
    [filteredProjects, loading, recentProjects, search],
  );
  const selectedMode = BUILD_MODES.find((mode) => mode.id === buildMode) ?? BUILD_MODES[0];

  return (
    <div className="builder-shell">
      <div className="builder-backdrop" />
      <div className="builder-glow builder-glow--green" />
      <div className="builder-glow builder-glow--purple" />
      <div className="builder-glow builder-glow--pink" />

      <PlatformShell headerMode="hidden" sidebarSections={sidebarSections} user={user}>
        {error ? (
          <div className="error-banner" role="alert">
            <strong>Dashboard Error</strong>
            <span>{error}</span>
          </div>
        ) : null}

        <section className="dashboard-launch-shell dashboard-launch-shell--minimal">
          <div className="dashboard-launch-hero">
            <p className="dashboard-launch-hero__eyebrow">Autonomous software studio</p>
            <h1 className="dashboard-wordmark">OmniForge</h1>
            <p className="builder-subtitle">
              Turn a prompt, website, or upload into a complete working product with preview,
              code, deployment, and publishing in one place.
            </p>
          </div>

          <article className="panel dashboard-command-panel">
            <div className="dashboard-mode-strip" role="tablist" aria-label="Build type">
              {BUILD_MODES.map((mode) => (
                <button
                  aria-selected={buildMode === mode.id}
                  className={`dashboard-mode-chip ${
                    buildMode === mode.id ? 'dashboard-mode-chip--active' : ''
                  }`}
                  key={mode.id}
                  onClick={() => setBuildMode(mode.id)}
                  type="button"
                >
                  {mode.label}
                </button>
              ))}
            </div>

            <div className="dashboard-command-panel__body">
              <label className="sr-only" htmlFor="dashboard-launch-prompt">
                Build prompt
              </label>
              <textarea
                id="dashboard-launch-prompt"
                className="dashboard-launch-input"
                onChange={(event) => setLaunchPrompt(event.target.value)}
                placeholder={`Ask OmniForge to build… Example: ${selectedMode.promptPrefix} for a rewards platform with secure login, dashboards, and publishing.`}
                rows={6}
                value={launchPrompt}
              />

              <div className="dashboard-command-panel__footer">
                <div className="dashboard-command-meta">
                  <span className="panel-badge">Prompt build</span>
                  <span className="panel-badge">Preview + publish</span>
                  <Link className="panel-badge panel-badge--link" to="/builder">
                    Source analysis studio
                  </Link>
                </div>

                <div className="dashboard-command-actions">
                  <Link className="platform-action platform-action--link" to="/builder">
                    Analyze site or files
                  </Link>
                  <button
                    className="prompt-submit"
                    disabled={creating}
                    onClick={handleCreateProject}
                    type="button"
                  >
                    {creating ? 'Launching OmniForge…' : 'Create Project'}
                  </button>
                </div>
              </div>

              <div className="dashboard-quick-actions">
                {QUICK_STARTS.map((value) => (
                  <button
                    className="dashboard-quick-pill"
                    key={value}
                    onClick={() => setLaunchPrompt(value)}
                    type="button"
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </article>

          <div className="dashboard-launch-shell__footer">
            <button className="platform-action" onClick={handleSignOut} type="button">
              Sign Out
            </button>
          </div>
        </section>
      </PlatformShell>
    </div>
  );
}
