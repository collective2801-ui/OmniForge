import { useEffect, useRef } from 'react';

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function SystemConsole({ logs, loading }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [logs, loading]);

  return (
    <section className="panel workspace-panel console-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">OmniForge Agent</p>
          <h2 className="panel-title">Live build conversation</h2>
        </div>

        <div className="console-status">
          <span className={`console-pulse ${loading ? 'console-pulse--active' : ''}`} />
          <span>{loading ? 'Streaming' : 'Idle'}</span>
        </div>
      </div>

      <div className="console-stream" role="log" aria-live="polite">
        {logs.length > 0 ? (
          logs.map((entry) => (
            <article
              className={`console-entry console-entry--${entry.level}`}
              key={entry.id}
            >
              <div className="console-entry__meta">
                <span className="console-entry__time">
                  {formatTimestamp(entry.timestamp)}
                </span>
                <span className="console-entry__stage">{entry.stage}</span>
              </div>
              <p className="console-entry__message">{entry.message}</p>
            </article>
          ))
        ) : (
          <div className="console-empty">
            Agent ready. Start a build to watch the execution stream unfold here.
          </div>
        )}
        <div ref={endRef} />
      </div>
    </section>
  );
}
