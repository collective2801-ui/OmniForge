export default function FileViewer({
  activeFile,
  files,
  onSelect,
  selectedPath,
}) {
  return (
    <section className="panel workspace-panel file-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">Generated Files</p>
          <h2 className="panel-title">Inspect the output package</h2>
        </div>
        <span className="panel-badge">{files.length} files</span>
      </div>

      <div className="file-viewer">
        <aside className="file-list" aria-label="Generated file list">
          {files.length > 0 ? (
            files.map((file) => (
              <button
                className={`file-list__item ${
                  file.path === selectedPath ? 'file-list__item--active' : ''
                }`}
                key={file.path}
                onClick={() => onSelect(file.path)}
                type="button"
              >
                <span className="file-list__name">{file.path}</span>
                <span className="file-list__meta">
                  {file.content.split('\n').length} lines
                </span>
              </button>
            ))
          ) : (
            <div className="file-empty">
              Generated files will appear here once the builder completes a run.
            </div>
          )}
        </aside>

        <div className="file-preview">
          {activeFile ? (
            <>
              <div className="file-preview__header">
                <span className="file-preview__path">{activeFile.path}</span>
                <span className="file-preview__meta">
                  {activeFile.content.length} characters
                </span>
              </div>
              <pre className="file-code">
                <code>{activeFile.content}</code>
              </pre>
            </>
          ) : (
            <div className="file-empty">
              Select a file to inspect its generated contents.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
