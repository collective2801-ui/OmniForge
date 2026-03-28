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
}) {
  return (
    <section className="omniforge-interface">
      <header className="omniforge-interface__header">
        <div className="omniforge-interface__identity">
          <p className="builder-kicker">OmniForge Studio</p>
          <h1>{title}</h1>
          {subtitle ? <p className="builder-subtitle">{subtitle}</p> : null}
        </div>

        {actions ? <div className="omniforge-interface__actions">{actions}</div> : null}
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
    </section>
  );
}
