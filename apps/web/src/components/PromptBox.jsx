function formatReferenceMeta(reference) {
  if (reference.type === 'website') {
    return reference.url;
  }

  const details = [];

  if (reference.kind === 'logo') {
    details.push('Logo');
  } else if (reference.kind === 'image') {
    details.push('Image');
  } else if (reference.kind === 'document') {
    details.push('Document');
  } else {
    details.push('File');
  }

  if (reference.width && reference.height) {
    details.push(`${reference.width}x${reference.height}`);
  }

  if (reference.size) {
    details.push(`${Math.max(1, Math.round(reference.size / 1024))} KB`);
  }

  return details.join(' • ');
}

function formatProjectType(value = '') {
  switch (value) {
    case 'mobile':
      return 'Mobile App';
    case 'website':
      return 'Website';
    case 'commerce':
      return 'Commerce App';
    default:
      return 'SaaS App';
  }
}

export function ReferenceOptionGrid({
  referenceBuildOptions = [],
  selectedBuildOptions = [],
  loading = false,
  processingReferences = false,
  onToggleReferenceOption,
  onUseReferenceOption,
  onBuildSelectedOptions,
}) {
  if (referenceBuildOptions.length === 0) {
    return null;
  }

  return (
    <div className="reference-option-block">
      <div className="reference-option-block__header">
        <div>
          <p className="panel-kicker">Options</p>
          <h3 className="panel-title">Choose a build direction</h3>
          <p className="reference-option-block__subcopy">
            Select one or two ideas, then build the selected apps.
          </p>
        </div>
        <div className="reference-option-block__toolbar">
          <span className="panel-badge">
            {selectedBuildOptions.length}/2 selected
          </span>
          <button
            className="prompt-submit prompt-submit--compact"
            disabled={loading || processingReferences || selectedBuildOptions.length === 0}
            onClick={() => void onBuildSelectedOptions?.()}
            type="button"
          >
            {selectedBuildOptions.length <= 1 ? 'Build Selected App' : 'Build Selected Apps'}
          </button>
        </div>
      </div>

      <div className="reference-option-grid" aria-label="Reference build options">
        {referenceBuildOptions.map((option) => (
          <article
            className={`reference-option-card ${
              selectedBuildOptions.some((selectedOption) => selectedOption.id === option.id)
                ? 'reference-option-card--selected'
                : ''
            }`}
            key={option.id}
          >
            <div className="reference-option-card__preview">
              <div className="reference-option-card__poster" aria-hidden="true">
                <div className="reference-option-card__poster-bar">
                  <span>{formatProjectType(option.projectType)}</span>
                  <strong>{option.moneyLabel || 'Business value'}</strong>
                </div>
                <div className="reference-option-card__poster-body">
                  <div>
                    <p className="reference-option-card__poster-title">
                      {option.name || option.title}
                    </p>
                    <p className="reference-option-card__poster-copy">
                      {option.description || option.summary}
                    </p>
                  </div>
                  <div className="reference-option-card__poster-metrics">
                    <div>
                      <span>Impact</span>
                      <strong>{option.cashFlowProjection?.monthlyLabel || 'Projected value'}</strong>
                    </div>
                    <div>
                      <span>Format</span>
                      <strong>{formatProjectType(option.projectType)}</strong>
                    </div>
                  </div>
                  <div className="reference-option-card__poster-pills">
                    {(option.featureList ?? option.features ?? []).slice(0, 3).map((feature) => (
                      <span key={`${option.id}-poster-${feature}`}>{feature}</span>
                    ))}
                  </div>
                </div>
              </div>
              {option.preview?.imageUrl ? (
                <img
                  alt={option.preview?.alt || `${option.name || option.title} preview`}
                  src={option.preview.imageUrl}
                />
              ) : null}
            </div>

            <div className="reference-option-card__copy">
              <div className="reference-option-card__header">
                <div className="reference-option-card__meta">
                  <span className="reference-option-card__eyebrow">
                    {option.audienceLabel || 'Business-specific concept'}
                  </span>
                  <span className="reference-option-card__divider">•</span>
                  <span className="reference-option-card__eyebrow">
                    {option.moneyLabel || 'Business value'}
                  </span>
                </div>
                <div className="reference-option-card__title-row">
                  <strong>{option.name || option.title}</strong>
                  <span className="reference-option-card__type">
                    {formatProjectType(option.projectType)}
                  </span>
                </div>
              </div>

              <p className="reference-option-card__description">{option.description || option.summary}</p>

              {option.usefulness ? (
                <div className="reference-option-card__section">
                  <span className="reference-option-card__eyebrow">Why it matters</span>
                  <p className="reference-option-card__body-text">{option.usefulness}</p>
                </div>
              ) : null}

              {option.cashFlowProjection ? (
                <div className="reference-option-card__metrics">
                  <div className="reference-option-card__metric">
                    <span>Projected value</span>
                    <strong>{option.cashFlowProjection.monthlyLabel}</strong>
                  </div>
                  <div className="reference-option-card__metric">
                    <span>Annualized</span>
                    <strong>{option.cashFlowProjection.annualLabel}</strong>
                  </div>
                </div>
              ) : null}

              {option.businessImpact ? (
                <div className="reference-option-card__section">
                  <span className="reference-option-card__eyebrow">Business impact</span>
                  <p className="reference-option-card__body-text">{option.businessImpact}</p>
                </div>
              ) : null}

              {option.cashFlowProjection?.basis ? (
                <div className="reference-option-card__basis">
                  Based on: {option.cashFlowProjection.basis}
                </div>
              ) : null}

              <div className="reference-option-card__feature-list">
                {(option.featureList ?? option.features ?? []).slice(0, 5).map((feature) => (
                  <div className="reference-option-card__feature" key={`${option.id}-${feature}`}>
                    <span />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="reference-option-card__actions">
              <button
                className="prompt-secondary"
                disabled={
                  loading ||
                  processingReferences ||
                  (
                    selectedBuildOptions.length >= 2 &&
                    !selectedBuildOptions.some((selectedOption) => selectedOption.id === option.id)
                  )
                }
                onClick={() => onToggleReferenceOption?.(option)}
                type="button"
              >
                {selectedBuildOptions.some((selectedOption) => selectedOption.id === option.id)
                  ? 'Selected'
                  : 'Select'}
              </button>

              <button
                className="prompt-secondary"
                disabled={loading || processingReferences}
                onClick={() => void onUseReferenceOption(option)}
                type="button"
              >
                Build This
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export default function PromptBox({
  mode = 'prompt',
  prompt,
  loading,
  processingReferences,
  references,
  referenceBuildOptions = [],
  selectedBuildOptions = [],
  selectedBuildOption = null,
  websiteDraft,
  onPromptChange,
  onWebsiteDraftChange,
  onAddWebsite,
  onFilesSelected,
  onRemoveReference,
  onToggleReferenceOption,
  onUseReferenceOption,
  onBuildSelectedOptions,
  onSubmit,
  onVoiceToggle,
  voice,
  showBuildOptions = true,
}) {
  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(prompt);
  }

  function handleWebsiteSubmit(event) {
    event?.preventDefault?.();
    void onAddWebsite(websiteDraft);
  }

  function handleFileSelection(event) {
    void onFilesSelected(event.target.files);
    event.target.value = '';
  }

  const isPromptMode = mode === 'prompt';
  const isWebsiteMode = mode === 'website';
  const isUploadMode = mode === 'upload';
  const showReferenceLibrary = !isPromptMode || references.length > 0 || referenceBuildOptions.length > 0;

  return (
    <section className="panel prompt-panel prompt-panel--minimal">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Composer</p>
          <h2 className="panel-title">
            {isPromptMode ? 'Build from prompt' : isWebsiteMode ? 'Build from website address' : 'Build from upload'}
          </h2>
        </div>
        <span className={`panel-badge ${loading ? 'panel-badge--running' : ''}`}>
          {loading ? 'Running' : processingReferences ? 'Analyzing references' : 'Ready'}
        </span>
      </div>

      <form className="prompt-form prompt-form--enhanced" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="builder-prompt">
          Builder prompt
        </label>

        {isPromptMode ? (
          <textarea
            id="builder-prompt"
            className="prompt-input prompt-input--minimal"
            value={prompt}
            onChange={(event) => onPromptChange(event.target.value)}
            placeholder="Build a SaaS app that..."
            rows={8}
          />
        ) : null}

        {isWebsiteMode ? (
          <div className="prompt-inline-row">
            <label className="sr-only" htmlFor="website-reference-input">
              Website reference
            </label>
            <input
              id="website-reference-input"
              className="prompt-reference-input prompt-reference-input--wide"
              type="url"
              value={websiteDraft}
              onChange={(event) => onWebsiteDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  handleWebsiteSubmit(event);
                }
              }}
              placeholder="https://example.com"
            />
            <button
              className="prompt-submit"
              disabled={loading || processingReferences || websiteDraft.trim().length === 0}
              onClick={handleWebsiteSubmit}
              type="button"
            >
              Analyze Website
            </button>
          </div>
        ) : null}

        {isUploadMode ? (
          <label className="prompt-upload prompt-upload--minimal" htmlFor="builder-reference-upload">
            <input
              id="builder-reference-upload"
              accept=".txt,.md,.markdown,.json,.csv,.pdf,.png,.jpg,.jpeg,.svg,.webp,.html,.css,.js,.ts,.tsx"
              multiple
              onChange={handleFileSelection}
              type="file"
            />
            <span>{processingReferences ? 'Analyzing files…' : 'Upload source files'}</span>
          </label>
        ) : null}

        {showReferenceLibrary ? (
          <div className="prompt-reference-panel prompt-reference-panel--minimal">
            <div className="prompt-reference-panel__header">
              <div>
                <p className="panel-kicker">Sources</p>
                <h3 className="panel-title">Reference inputs</h3>
              </div>
              <span className="prompt-reference-panel__count">{references.length} attached</span>
            </div>

          {showBuildOptions ? (
            <ReferenceOptionGrid
              loading={loading}
              onBuildSelectedOptions={onBuildSelectedOptions}
              onToggleReferenceOption={onToggleReferenceOption}
              onUseReferenceOption={onUseReferenceOption}
              processingReferences={processingReferences}
              referenceBuildOptions={referenceBuildOptions}
              selectedBuildOptions={selectedBuildOptions}
            />
          ) : null}

          {references.length > 0 ? (
            <div className="reference-chip-grid" aria-label="Attached source references">
              {references.map((reference) => (
                <article className="reference-chip" key={reference.id}>
                  <div className="reference-chip__media">
                    {reference.previewUrl ? (
                      <img
                        alt={reference.label}
                        className="reference-chip__preview"
                        src={reference.previewUrl}
                      />
                    ) : (
                      <span
                        className="reference-chip__swatch"
                        style={{
                          background: reference.dominantColor || 'rgba(148, 163, 184, 0.18)',
                        }}
                      />
                    )}
                  </div>

                  <div className="reference-chip__body">
                    <div className="reference-chip__top">
                      <strong>{reference.label}</strong>
                      <button
                        className="reference-chip__remove"
                        onClick={() => onRemoveReference(reference.id)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                    <p>{reference.summary}</p>
                    <span>{formatReferenceMeta(reference)}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="prompt-reference-empty">
              {isWebsiteMode
                ? 'Paste a website address to analyze it and generate build options.'
                : 'Upload a source file and OmniForge will generate build options.'}
            </div>
          )}
          </div>
        ) : null}

        {isPromptMode ? (
          <div className="prompt-actions prompt-actions--minimal">
            <div className="prompt-action-group">
            <button
              className={`voice-toggle ${
                voice.listening ? 'voice-toggle--active' : ''
              } ${!voice.supported ? 'voice-toggle--disabled' : ''}`}
              disabled={!voice.supported || (loading && !voice.listening)}
              onClick={onVoiceToggle}
              type="button"
            >
              {voice.listening ? 'Stop Voice' : 'Voice Input'}
            </button>

            <button
              className="prompt-submit"
              disabled={loading || processingReferences}
              type="submit"
            >
              {loading ? 'Building…' : 'Build'}
            </button>
            </div>
          </div>
        ) : null}

        {isPromptMode && (voice.error || voice.transcript) ? (
          <div className="voice-inline-status">
            {voice.error ? (
              <p>{voice.error}</p>
            ) : (
              <p>Live transcript: {voice.transcript}</p>
            )}
          </div>
        ) : null}
      </form>
    </section>
  );
}
