import assert from 'node:assert/strict';
import test from 'node:test';
import {knownPublisherRoutes, publisherRoute} from '../scripts/publisher_route_policy.mjs';

test('viewer publishers separate loading the viewer from saving its PDF', () => {
  for (const publisher of ['copernicus', 'acs', 'elsevier', 'ScienceDirect', 'Elsevier / ScienceDirect']) {
    const waiting = publisherRoute(publisher);
    assert.equal(waiting.transfer_stage, 'viewer_load');
    assert.equal(waiting.route_status, 'hint');
    assert.equal(waiting.capture, 'loaded_viewer_sdk');
    assert.equal(waiting.action, 'wait_for_viewer_then_observe_download');
    assert.equal(publisherRoute(publisher, {viewerLoaded:true}).action, 'capture_loaded_viewer');
    assert.equal(waiting.selector, 'observed_viewer_download');
  }
});

test('MDPI and Frontiers use the article PDF and shared record collection', () => {
  const mdpi = publisherRoute('MDPI journals');
  assert.equal(mdpi.publisher, 'mdpi');
  assert.equal(mdpi.entry, 'article_pdf_url');
  assert.equal(mdpi.selector, 'article_pdf_only');
  assert.equal(mdpi.capture, 'shared_pool_record');
  assert.equal(mdpi.expected_bytes, 'recommended');
  assert.equal(mdpi.concurrency, 'agent_decides');
  assert.equal(publisherRoute('frontiers').capture, 'shared_pool_record');
  assert.equal(publisherRoute('frontiers').action, 'trigger_observed_article_pdf');
});

test('unlisted publishers proceed through live page observation', () => {
  const unknown = publisherRoute('unknown-example');
  assert.deepEqual(unknown, {publisher:'unknown-example', route_status:'unlisted', action:'inspect_live_page'});
  assert.equal(publisherRoute('unknown-example', {viewerLoaded:true}).action, 'capture_loaded_viewer');
});

test('known route list includes the viewer routes needed by the eight-paper batch', () => {
  assert.deepEqual(knownPublisherRoutes(), ['copernicus', 'acs', 'elsevier', 'mdpi', 'frontiers']);
});

test('route input is validated', () => {
  assert.throws(() => publisherRoute(''), /publisher required/);
  assert.throws(() => publisherRoute('mdpi', {viewerLoaded:'yes'}), /viewerLoaded must be boolean/);
});
