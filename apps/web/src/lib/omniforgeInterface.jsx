import { useEffect, useMemo, useState } from 'react';

export const OMNIFORGE_INTERFACE_MODES = Object.freeze([
  {
    id: 'prompt',
    label: 'Prompt Build',
    description: 'Type what to build and run the agent directly.',
  },
  {
    id: 'website',
    label: 'Analyze Website',
    description: 'Paste a URL, generate build directions, and choose one.',
  },
  {
    id: 'upload',
    label: 'Upload & Build',
    description: 'Upload source material, analyze it, and build from a selected direction.',
  },
]);

function normalizeCommandItems(items = []) {
  return items.filter((item) => item && typeof item === 'object' && typeof item.label === 'string');
}

export default function OmniForgeInterface({
  title = 'OmniForge',
  subtitle = '',
  modes = OMNIFORGE_INTERFACE_MODES,
  activeMode = 'prompt',
  onModeChange,
  actions = null,
  leftPanel = null,
  centerPanel = null,
  rightPanel = null,
  statusMeta = null,
  commandPalette = null,
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState('');

  useEffect(() => {
    function handleKeyDown(event) {
      const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';

      if (isShortcut) {
        event.preventDefault();
        setPaletteOpen((current) => !current);
      }

      if (event.key === 'Escape') {
        setPaletteOpen(false);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!paletteOpen) {
      setPaletteQuery('');
    }
  }, [paletteOpen]);

  const paletteItems = useMemo(() => {
    const normalizedItems = normalizeCommandItems(commandPalette?.items ?? []);
    const normalizedQuery = paletteQuery.trim().toLowerCase();

    if (!normalizedQuery) {
      return normalizedItems;
    }

    return normalizedItems.filter((item) =>
      [item.label, item.description, ...(item.keywords ?? [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [commandPalette?.items, paletteQuery]);

  function handleCommandSelect(item) {
    setPaletteOpen(false);
    setPaletteQuery('');
    item.onSelect?.();
  }

  return (
    <section className="omniforge-interface">
      <header className="omniforge-interface__header">
        <div className="omniforge-interface__identity">
          <div className="omniforge-interface__eyebrow-row">
            <p className="builder-kicker">OmniForge Studio</p>
            {statusMeta ? (
              <span className={`omniforge-interface__status omniforge-interface__status--${statusMeta.tone ?? 'idle'}`}>
                {statusMeta.label}
              </span>
            ) : null}
          </div>

          <h1>{title}</h1>
          {subtitle ? <p className="builder-subtitle">{subtitle}</p> : null}

          {statusMeta ? (
            <div className="omniforge-interface__pulse">
              <div className="omniforge-interface__pulse-copy">
                <strong>{statusMeta.headline}</strong>
                <span>{statusMeta.summary}</span>
              </div>
              <div className="omniforge-interface__pulse-rail" aria-hidden="true">
                <span
                  className="omniforge-interface__pulse-bar"
                  style={{ width: `${statusMeta.percent ?? 0}%` }}
                />
              </div>
              <span className="omniforge-interface__pulse-value">
                {statusMeta.percent ?? 0}%
              </span>
            </div>
          ) : null}
        </div>

        <div className="omniforge-interface__header-tools">
          {commandPalette ? (
            <button
              className="omniforge-command-trigger"
              onClick={() => setPaletteOpen(true)}
              type="button"
            >
              <span>Command Menu</span>
              <kbd>⌘K</kbd>
            </button>
          ) : null}

          {actions ? <div className="omniforge-interface__actions">{actions}</div> : null}
        </div>
      </header>

      <div className="omniforge-interface__mode-strip" role="tablist" aria-label="Build modes">
        {modes.map((mode) => (
          <button
            aria-selected={activeMode === mode.id}
            className={`omniforge-interface__mode ${
              activeMode === mode.id ? 'omniforge-interface__mode--active' : ''
            }`}
            key={mode.id}
            onClick={() => onModeChange?.(mode.id)}
            type="button"
          >
            <strong>{mode.label}</strong>
            <span>{mode.description}</span>
          </button>
        ))}
      </div>

      <div className="omniforge-interface__grid">
        <aside className="omniforge-interface__panel omniforge-interface__panel--left">
          {leftPanel}
        </aside>

        <section className="omniforge-interface__panel omniforge-interface__panel--center">
          {centerPanel}
        </section>

        <aside className="omniforge-interface__panel omniforge-interface__panel--right">
          {rightPanel}
        </aside>
      </div>

      {commandPalette ? (
        <div
          aria-hidden={!paletteOpen}
          className={`omniforge-command-palette ${paletteOpen ? 'omniforge-command-palette--open' : ''}`}
        >
          <button
            aria-label="Close command palette"
            className="omniforge-command-palette__backdrop"
            onClick={() => setPaletteOpen(false)}
            type="button"
          />

          <section className="omniforge-command-palette__panel" role="dialog" aria-modal="true">
            <header className="omniforge-command-palette__header">
              <div>
                <p className="panel-kicker">Quick Commands</p>
                <h2 className="panel-title">{commandPalette.title ?? 'Move instantly through OmniForge'}</h2>
              </div>
              <kbd className="omniforge-command-palette__escape">Esc</kbd>
            </header>

            <label className="sr-only" htmlFor="omniforge-command-search">
              Search commands
            </label>
            <input
              autoFocus={paletteOpen}
              className="omniforge-command-palette__input"
              id="omniforge-command-search"
              onChange={(event) => setPaletteQuery(event.target.value)}
              placeholder={commandPalette.placeholder ?? 'Search commands, projects, or actions'}
              type="search"
              value={paletteQuery}
            />

            <div className="omniforge-command-palette__list" role="listbox">
              {paletteItems.length > 0 ? (
                paletteItems.map((item) => (
                  <button
                    className="omniforge-command-palette__item"
                    key={item.id}
                    onClick={() => handleCommandSelect(item)}
                    type="button"
                  >
                    <div className="omniforge-command-palette__item-copy">
                      <strong>{item.label}</strong>
                      {item.description ? <span>{item.description}</span> : null}
                    </div>
                    {item.shortcut ? (
                      <kbd className="omniforge-command-palette__shortcut">{item.shortcut}</kbd>
                    ) : null}
                  </button>
                ))
              ) : (
                <div className="omniforge-command-palette__empty">
                  No matching command. Try “build”, “analyze”, or a project name.
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
