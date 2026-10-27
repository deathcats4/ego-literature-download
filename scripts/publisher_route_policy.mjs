// Optional hints from prior observations. The live page remains authoritative.

const ROUTES = Object.freeze({
  copernicus: Object.freeze({
    entry: 'article_pdf_url', transfer_stage: 'viewer_load',
    capture: 'loaded_viewer_sdk', concurrency: 'agent_decides',
    selector: 'observed_viewer_download', expected_bytes: 'recommended',
  }),
  acs: Object.freeze({
    entry: 'article_pdf_link', transfer_stage: 'viewer_load',
    capture: 'loaded_viewer_sdk', concurrency: 'agent_decides',
    selector: 'observed_viewer_download', expected_bytes: 'recommended',
  }),
  elsevier: Object.freeze({
    entry: 'article_pdf_link', transfer_stage: 'viewer_load',
    capture: 'loaded_viewer_sdk', concurrency: 'agent_decides',
    selector: 'observed_viewer_download', expected_bytes: 'recommended',
  }),
  mdpi: Object.freeze({
    entry: 'article_pdf_url', transfer_stage: 'direct_download',
    capture: 'shared_pool_record', concurrency: 'agent_decides',
    selector: 'article_pdf_only', expected_bytes: 'recommended',
  }),
  frontiers: Object.freeze({
    entry: 'article_pdf_url', transfer_stage: 'direct_download',
    capture: 'shared_pool_record', concurrency: 'shared_pool',
    selector: 'article_pdf_only', expected_bytes: 'recommended',
  }),
});

const ALIASES = Object.freeze({
  'copernicus publications': 'copernicus',
  'american chemical society': 'acs',
  'acs publications': 'acs',
  'science direct': 'elsevier',
  sciencedirect: 'elsevier',
  'elsevier/sciencedirect': 'elsevier',
  'elsevier / sciencedirect': 'elsevier',
  'mdpi journals': 'mdpi',
  'frontiers in': 'frontiers',
});

function normalizePublisher(value) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('publisher required');
  const normalized = value.trim().toLowerCase();
  return ALIASES[normalized] ?? normalized;
}

/**
 * Return an immutable route policy for a known publisher.
 * `viewerLoaded` is an observation supplied by the worker. A PDF click is
 * never treated as a completed download before the viewer Download control is
 * observed.
 */
export function publisherRoute(publisher, {viewerLoaded = false} = {}) {
  if (typeof viewerLoaded !== 'boolean') throw new TypeError('viewerLoaded must be boolean');
  const key = normalizePublisher(publisher);
  const route = ROUTES[key];
  if (!route) return {publisher: key, route_status: 'unlisted',
    action: viewerLoaded ? 'capture_loaded_viewer' : 'inspect_live_page'};
  return {
    publisher: key, route_status: 'hint', ...route,
    action: route.transfer_stage === 'viewer_load'
      ? (viewerLoaded ? 'capture_loaded_viewer' : 'wait_for_viewer_then_observe_download')
      : 'trigger_observed_article_pdf',
  };
}

export function knownPublisherRoutes() {
  return Object.keys(ROUTES);
}
