function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getStatusTone(state) {
  switch (state) {
    case 'running':
    case 'executing':
    case 'indexing':
    case 'syncing':
      return 'active';
    case 'completed':
    case 'ready':
    case 'synced':
      return 'healthy';
    case 'warning':
    case 'inferred':
      return 'warning';
    case 'failed':
    case 'error':
      return 'error';
    default:
      return 'idle';
  }
}

function createDeliveryCards(delivery = {}, status = {}) {
  const deliveryCards = [];
  const integrations = delivery.integrations ?? null;
  const finalization = delivery.finalization ?? null;
  const deployment = delivery.deployment ?? null;
  const domain = delivery.domain ?? null;
  const mobile = delivery.mobile ?? null;
  const store = delivery.store ?? null;
  const unifiedAPI = delivery.unifiedAPI ?? null;
  const runtime = delivery.runtime ?? null;
  const business = delivery.business ?? null;
  const growth = delivery.growth ?? null;
  const autonomous = delivery.autonomous === true;

  if (status.lastTask?.state === 'completed' || status.lastTask?.state === 'running') {
    if (status.lastTask?.state === 'completed') {
      deliveryCards.push({
        id: 'builder-ready',
        label: 'Builder',
        value: 'Ready',
        detail: 'Execution completed and the latest delivery data is available below.',
        tone: 'healthy',
      });
    }
  }

  if (integrations?.status && integrations.status !== 'skipped') {
    deliveryCards.push({
      id: 'integrations',
      label: 'Integrations',
      value:
        integrations.status === 'configured'
          ? `${integrations.integrations?.length ?? 0} configured`
          : integrations.status,
      detail:
        Array.isArray(integrations.integrations) && integrations.integrations.length > 0
          ? `Connected: ${integrations.integrations.join(', ')}.`
          : integrations.error || 'Integration scaffolding is ready.',
      tone: getStatusTone(integrations.status),
      meta:
        Array.isArray(integrations.envKeys) && integrations.envKeys.length > 0
          ? `${integrations.envKeys.length} environment keys prepared`
          : '',
    });
  }

  if (finalization?.status) {
    deliveryCards.push({
      id: 'finalization',
      label: 'Finalization',
      value: finalization.validated ? 'Validated' : finalization.status,
      detail:
        finalization.validated
          ? 'The generated app passed the final validation and retry loop.'
          : 'Final validation found remaining issues.',
      tone: getStatusTone(finalization.validated ? 'completed' : finalization.status),
      meta:
        typeof finalization.retries === 'number'
          ? `Retries: ${finalization.retries} • Issues fixed: ${finalization.issuesFixed ? 'yes' : 'no'}`
          : '',
    });
  }

  if (deployment?.status || deployment?.url) {
    const deploymentState =
      deployment.status === 'deployed'
        ? 'completed'
        : deployment.status === 'failed'
          ? 'error'
          : deployment.status === 'deploying'
            ? 'running'
            : deployment.status || 'idle';
    const deploymentNotes = [];

    if (deployment.provider) {
      deploymentNotes.push(`Provider: ${deployment.provider}.`);
    }

    if (deployment.repository?.directDeploy) {
      deploymentNotes.push('Direct deploy is active, so GitHub is optional.');
    }

    deliveryCards.push({
      id: 'deployment',
      label: 'Deployment',
      value: deployment.url ? 'Live' : deployment.status || 'prepared',
      detail:
        deployment.url
          ? `App deployed successfully${deployment.provider ? ` via ${deployment.provider}` : ''}.`
          : deployment.error || deploymentNotes.join(' ') || 'Deployment pipeline is ready.',
      tone: getStatusTone(deploymentState),
      meta: deploymentNotes.join(' '),
      href: deployment.url || '',
      hrefLabel: deployment.url ? 'Open live app' : '',
    });
  }

  if (domain?.domain || domain?.status) {
    const domainState =
      domain.status === 'ready'
        ? 'completed'
        : domain.status === 'failed'
          ? 'error'
          : domain.status === 'manual_review'
            ? 'warning'
            : domain.status || 'idle';
    const domainNotes = [];

    if (domain.selectedProvider || domain.provider) {
      domainNotes.push(`Registrar: ${domain.selectedProvider || domain.provider}.`);
    }

    if (domain.dns?.targetHost || domain.attachment?.targetHost) {
      domainNotes.push(`DNS target: ${domain.dns?.targetHost || domain.attachment?.targetHost}.`);
    }

    deliveryCards.push({
      id: 'domain',
      label: 'Domain',
      value: domain.domain || domain.status || 'planned',
      detail:
        domain.error ||
        domain.purchaseWorkflow?.steps?.[0] ||
        domain.notes?.[0] ||
        'Custom domain planning is ready.',
      tone: getStatusTone(domainState),
      meta: domainNotes.join(' '),
      href: domain.purchaseWorkflow?.checkoutUrl || domain.purchaseUrl || '',
      hrefLabel:
        domain.purchaseWorkflow?.checkoutUrl || domain.purchaseUrl
          ? 'Open registrar checkout'
          : '',
    });
  }

  if (mobile?.status || Array.isArray(mobile?.platforms)) {
    deliveryCards.push({
      id: 'mobile',
      label: 'Mobile',
      value: mobile.status || 'prepared',
      detail:
        Array.isArray(mobile.platforms) && mobile.platforms.length > 0
          ? `Targets: ${mobile.platforms.join(', ')}.`
          : 'Mobile app scaffold is prepared.',
      tone: getStatusTone(
        mobile.status === 'ready'
          ? 'completed'
          : mobile.status === 'failed'
            ? 'error'
            : mobile.status || 'idle',
      ),
      meta:
        mobile.androidPackage || mobile.iosBundleIdentifier
          ? [mobile.androidPackage, mobile.iosBundleIdentifier].filter(Boolean).join(' • ')
          : '',
    });
  }

  if (store?.status || store?.submissionReady === true) {
    deliveryCards.push({
      id: 'store',
      label: 'Store',
      value: store.submissionReady ? 'Submission ready' : store.status || 'planned',
      detail:
        Array.isArray(store.platforms) && store.platforms.length > 0
          ? `Prepared for ${store.platforms.join(', ')} submission.`
          : 'Store submission pipeline is ready.',
      tone: getStatusTone(
        store.submissionReady
          ? 'completed'
          : store.status === 'failed'
            ? 'error'
            : store.status || 'idle',
      ),
    });
  }

  if (unifiedAPI?.status || Array.isArray(unifiedAPI?.apis)) {
    deliveryCards.push({
      id: 'unified-api',
      label: 'Unified API',
      value:
        unifiedAPI.status === 'configured'
          ? `${unifiedAPI.apis?.length ?? 0} mapped`
          : unifiedAPI.status || 'planned',
      detail:
        Array.isArray(unifiedAPI.apis) && unifiedAPI.apis.length > 0
          ? `APIs: ${unifiedAPI.apis.join(', ')}.`
          : unifiedAPI.error || 'Provider abstraction is ready.',
      tone: getStatusTone(unifiedAPI.status || 'idle'),
      meta:
        unifiedAPI.providers && typeof unifiedAPI.providers === 'object'
          ? Object.entries(unifiedAPI.providers)
            .map(([service, provider]) => `${service}: ${provider}`)
            .join(' • ')
          : '',
    });
  }

  if (runtime?.status || runtime?.issuesFixed === true) {
    deliveryCards.push({
      id: 'runtime',
      label: 'Runtime',
      value: runtime.status || 'idle',
      detail:
        runtime.issuesFixed
          ? 'Runtime checks ran and auto-fixed at least one issue.'
          : 'Runtime diagnostics completed without blocking issues.',
      tone: getStatusTone(runtime.status || 'idle'),
      meta:
        runtime.issueCount || runtime.securityWarningCount
          ? `Issues: ${runtime.issueCount ?? 0} • Security warnings: ${runtime.securityWarningCount ?? 0}`
          : '',
    });
  }

  if (business?.pricingTiers || autonomous) {
    deliveryCards.push({
      id: 'business',
      label: 'Business',
      value:
        Array.isArray(business?.pricingTiers)
          ? `${business.pricingTiers.length} tiers`
          : autonomous
            ? 'Autonomous'
            : 'ready',
      detail:
        business?.subscriptionModel ||
        'Business model, pricing, and onboarding structure are prepared.',
      tone: 'healthy',
    });
  }

  if (growth?.adAngles || growth?.ugcContentScripts) {
    deliveryCards.push({
      id: 'growth',
      label: 'Growth',
      value:
        Array.isArray(growth?.adAngles)
          ? `${growth.adAngles.length} angles`
          : 'ready',
      detail: 'Growth plan includes ads, funnel ideas, SEO, and UGC direction.',
      tone: 'healthy',
    });
  }

  return deliveryCards;
}

export default function SystemStatus({ delivery, intent, loading, status }) {
  const deliveryCards = createDeliveryCards(delivery, status);
  const cards = [
    { id: 'engine', label: 'Engine', data: status.engine },
    { id: 'memory', label: 'Memory', data: status.memory },
    { id: 'orchestrator', label: 'Orchestrator', data: status.orchestrator },
    { id: 'lastTask', label: 'Last Task', data: status.lastTask },
  ];

  return (
    <section className="panel status-panel">
      <div className="panel-header">
        <div>
          <p className="panel-kicker">System State</p>
          <h2 className="panel-title">Builder execution map</h2>
        </div>
        <span className={`panel-badge ${loading ? 'panel-badge--running' : ''}`}>
          {status.projectName || 'No project'}
        </span>
      </div>

      <div className="status-grid">
        {cards.map((card) => (
          <article className="status-card-v2" key={card.id}>
            <div className="status-card-v2__top">
              <span>{card.label}</span>
              <span
                className={`status-state status-state--${getStatusTone(card.data.state)}`}
              >
                {card.data.state}
              </span>
            </div>
            <p>{card.data.detail}</p>
          </article>
        ))}
      </div>

      <div className="pipeline-grid" aria-label="Execution stages">
        {status.pipeline.map((stage) => (
          <article
            className={`pipeline-node pipeline-node--${stage.state}`}
            key={stage.id}
          >
            <span className={`pipeline-node__dot pipeline-node__dot--${stage.accent}`} />
            <div>
              <strong>{stage.label}</strong>
              <p>{stage.description}</p>
            </div>
          </article>
        ))}
      </div>

      {deliveryCards.length > 0 ? (
        <div className="delivery-grid" aria-label="Delivery outcomes">
          {deliveryCards.map((card) => (
            <article className="delivery-card" key={card.id}>
              <div className="delivery-card__top">
                <span>{card.label}</span>
                <span className={`status-state status-state--${card.tone || 'idle'}`}>
                  {card.value}
                </span>
              </div>
              <p>{card.detail}</p>
              {card.meta ? <span className="delivery-card__meta">{card.meta}</span> : null}
              {card.href ? (
                <a
                  className="delivery-card__link"
                  href={card.href}
                  rel="noreferrer"
                  target="_blank"
                >
                  {card.hrefLabel || 'Open'}
                </a>
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      <div className="status-footer">
        <div className="status-footer__meta">
          <span>Route: {status.routeCategory}</span>
          <span>Files: {status.generatedFilesCount}</span>
          <span>Updated: {formatTimestamp(status.updatedAt)}</span>
        </div>

        {intent ? (
          <div className="intent-ribbon" aria-label="Resolved intent">
            <span className="intent-pill">{intent.goal}</span>
            <span className="intent-pill">{intent.projectType}</span>
            <span className="intent-pill">{intent.complexity}</span>
            <span className="intent-pill">{intent.priority}</span>
            {intent.features.map((feature) => (
              <span className="intent-pill intent-pill--feature" key={feature}>
                {feature.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        ) : (
          <p className="status-placeholder">
            Awaiting a prompt. OmniForge will surface inferred goal, project
            type, features, and execution stages here.
          </p>
        )}
      </div>
    </section>
  );
}
