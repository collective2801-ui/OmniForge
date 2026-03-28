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

export default function PromptBox({
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
  onSubmit,
  onVoiceToggle,
  voice,
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

  return (
    <section className="panel prompt-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Composer</p>
          <h2 className="panel-title">Build from prompt, site, or upload</h2>
        </div>
        <span className={`panel-badge ${loading ? 'panel-badge--running' : ''}`}>
          {loading ? 'Running' : processingReferences ? 'Analyzing references' : 'Ready'}
        </span>
      </div>

      <form className="prompt-form prompt-form--enhanced" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="builder-prompt">
          Builder prompt
        </label>

        <textarea
          id="builder-prompt"
          className="prompt-input"
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Describe what OmniForge should build. You can also skip this and build from a website or uploaded source instead."
          rows={6}
        />

        <div className="prompt-reference-panel">
          <div className="prompt-reference-panel__header">
            <div>
              <p className="panel-kicker">Reference Inputs</p>
              <h3 className="panel-title">Website links and source files</h3>
            </div>
            <span className="prompt-reference-panel__count">
              {references.length} attached
            </span>
          </div>

          <div className="prompt-reference-actions">
            <div className="website-reference-form">
              <label className="sr-only" htmlFor="website-reference-input">
                Website reference
              </label>
              <input
                id="website-reference-input"
                className="prompt-reference-input"
                type="url"
                value={websiteDraft}
                onChange={(event) => onWebsiteDraftChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    handleWebsiteSubmit(event);
                  }
                }}
                placeholder="Paste a website URL to analyze style, copy, and structure"
              />
              <button
                className="prompt-secondary"
                disabled={loading || processingReferences || websiteDraft.trim().length === 0}
                onClick={handleWebsiteSubmit}
                type="button"
              >
                Analyze site
              </button>
            </div>

            <label className="prompt-upload" htmlFor="builder-reference-upload">
              <input
                id="builder-reference-upload"
                accept=".txt,.md,.markdown,.json,.csv,.pdf,.png,.jpg,.jpeg,.svg,.webp,.html,.css,.js,.ts,.tsx"
                multiple
                onChange={handleFileSelection}
                type="file"
              />
              <span>{processingReferences ? 'Analyzing files…' : 'Upload source files'}</span>
            </label>
          </div>

          {referenceBuildOptions.length > 0 ? (
            <div className="reference-option-block">
              <div className="reference-option-block__header">
                <div>
                  <p className="panel-kicker">Generated Build Directions</p>
                  <h3 className="panel-title">Pick one and OmniForge will build it</h3>
                </div>
                <span className="panel-badge">
                  {selectedBuildOptions.length}/2 selected
                </span>
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
                    <div className="reference-option-card__copy">
                      <strong>{option.name || option.title}</strong>
                      <p>{option.description || option.summary}</p>
                      <div className="prompt-hints">
                        {(option.features ?? []).slice(0, 4).map((feature) => (
                          <span className="prompt-hint" key={`${option.id}-${feature}`}>
                            {feature}
                          </span>
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
              Add a logo, brief, spreadsheet, site, or source file. OmniForge will analyze it and
              return four build directions you can choose from.
            </div>
          )}
        </div>

        <div className="prompt-actions prompt-actions--enhanced">
          <p className="prompt-meta">
            OmniForge builds from prompt or source input and keeps the active workspace focused on
            the build, preview, code, and publish path.
          </p>

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
              {loading ? 'Running OmniForge…' : 'Build from Prompt + References'}
            </button>
          </div>
        </div>

        {(voice.error || voice.transcript) ? (
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
