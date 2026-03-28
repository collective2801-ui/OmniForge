import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';

function createDisplayName(user) {
  if (!user?.email) {
    return 'OmniForge User';
  }

  const [localPart = 'OmniForge User'] = user.email.split('@');
  return localPart
    .split(/[._-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function PlatformShell({
  user = null,
  project = null,
  sidebarSections = [],
  eyebrow = 'OmniForge',
  title,
  description,
  actions = null,
  headerMode = 'default',
  children,
}) {
  const primaryNav = [
    {
      to: '/dashboard',
      label: 'Home',
      description: '',
      end: false,
    },
    {
      to: '/builder',
      label: 'Studio',
      description: '',
      end: false,
    },
  ];

  const projectNav = project?.id
    ? [
        {
          to: `/projects/${encodeURIComponent(project.id)}`,
          label: 'Workspace',
          description: project.name || 'Open the active project editor',
          end: false,
        },
      ]
    : [];
  const [openSections, setOpenSections] = useState(() =>
    sidebarSections.reduce((sections, section) => {
      sections[section.id] = section.defaultOpen !== false;
      return sections;
    }, {}),
  );

  useEffect(() => {
    setOpenSections((currentSections) =>
      sidebarSections.reduce((nextSections, section) => {
        nextSections[section.id] =
          currentSections[section.id] ?? section.defaultOpen !== false;
        return nextSections;
      }, {}),
    );
  }, [sidebarSections]);

  function toggleSection(sectionId) {
    setOpenSections((currentSections) => ({
      ...currentSections,
      [sectionId]: !currentSections[sectionId],
    }));
  }

  function renderSidebarItem(item) {
    const content = (
      <>
        <div className="platform-nav__item-row">
          <strong>{item.label}</strong>
          {item.badge ? <span className="panel-badge">{item.badge}</span> : null}
        </div>
        {item.description ? <span>{item.description}</span> : null}
      </>
    );

    if (item.href) {
      return (
        <a
          className="platform-nav__item platform-nav__item--compact"
          href={item.href}
          key={item.key ?? item.href}
          rel={item.external ? 'noreferrer' : undefined}
          target={item.external ? '_blank' : undefined}
        >
          {content}
        </a>
      );
    }

    return (
      <NavLink
        className={({ isActive }) =>
          `platform-nav__item platform-nav__item--compact ${
            isActive ? 'platform-nav__item--active' : ''
          }`
        }
        end={item.end ?? false}
        key={item.key ?? item.to}
        to={item.to}
      >
        {content}
      </NavLink>
    );
  }

  return (
    <main className="platform-frame">
      <aside className="platform-sidebar">
        <Link className="platform-brand" to="/dashboard">
          <span className="platform-brand__glyph">OF</span>
          <div>
            <strong>OmniForge</strong>
            <span>Prompt, analyze, publish</span>
          </div>
        </Link>

        <div className="platform-sidebar__section">
          <span className="platform-sidebar__label">Workspace</span>
          <nav className="platform-nav">
            {primaryNav.map((item) => (
              <NavLink
                className={({ isActive }) =>
                  `platform-nav__item ${isActive ? 'platform-nav__item--active' : ''}`
                }
                end={item.end}
                key={item.to}
                to={item.to}
              >
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        {projectNav.length > 0 ? (
          <div className="platform-sidebar__section">
            <span className="platform-sidebar__label">Current Project</span>
            <nav className="platform-nav">
              {projectNav.map((item) => (
                <NavLink
                  className={({ isActive }) =>
                    `platform-nav__item ${isActive ? 'platform-nav__item--active' : ''}`
                  }
                  end={item.end}
                  key={item.to}
                  to={item.to}
                >
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </NavLink>
              ))}
            </nav>
          </div>
        ) : null}

        {sidebarSections.map((section) => {
          const isOpen = openSections[section.id] !== false;
          const itemCount = Array.isArray(section.items) ? section.items.length : 0;

          return (
            <div className="platform-sidebar__section" key={section.id}>
              <button
                aria-expanded={isOpen}
                className="platform-sidebar__section-toggle"
                onClick={() => toggleSection(section.id)}
                type="button"
              >
                <span className="platform-sidebar__label">{section.label}</span>
                <span className="platform-sidebar__section-meta">
                  {typeof section.count === 'number' ? section.count : itemCount}
                  <span className="platform-sidebar__toggle-icon">{isOpen ? '−' : '+'}</span>
                </span>
              </button>

              {isOpen ? (
                <>
                  {section.control ? (
                    <div className="platform-sidebar__control">{section.control}</div>
                  ) : null}

                  {itemCount > 0 ? (
                    <div className="platform-nav platform-sidebar__list">
                      {section.items.map((item) => renderSidebarItem(item))}
                    </div>
                  ) : (
                    <div className="platform-sidebar__empty">
                      {section.emptyMessage ?? 'Nothing is available yet.'}
                    </div>
                  )}
                </>
              ) : null}
            </div>
          );
        })}

        <div className="platform-sidebar__footer">
          <span className="platform-sidebar__label">Session</span>
          <div className="platform-user-card">
            <div className="platform-user-card__identity">
              <strong>{createDisplayName(user)}</strong>
              <span>{user?.email || 'Signed in workspace'}</span>
            </div>
            {user?.role ? <span className="panel-badge">{user.role}</span> : null}
          </div>
        </div>
      </aside>

      <section className="platform-main">
        {headerMode !== 'hidden' ? (
          <header
            className={`platform-header ${
              headerMode === 'compact' ? 'platform-header--compact' : ''
            }`}
          >
            <div className="platform-header__content">
              <p className="builder-kicker">{eyebrow}</p>
              <h1>{title}</h1>
              {description ? <p className="builder-subtitle">{description}</p> : null}
            </div>

            {actions ? <div className="platform-header__actions">{actions}</div> : null}
          </header>
        ) : null}

        <div className="platform-content">{children}</div>
      </section>
    </main>
  );
}
