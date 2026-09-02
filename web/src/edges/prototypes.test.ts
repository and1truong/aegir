import assert from 'node:assert/strict';
import test from 'node:test';
import type { SysEdge } from '../data/types.ts';
import { buildEdgePrototype, edgePrototypeStages, measureEdgePrototype, routingDecision } from './prototypes.ts';

const edges: SysEdge[] = [
  { id: 'call-a', source: 'a', target: 'b', kind: 'calls', evidenceRefs: ['code-a'] },
  { id: 'call-b', source: 'b', target: 'c', kind: 'calls', pr: 'added', evidenceRefs: ['code-b'] },
  { id: 'write', source: 'a', target: 'db', kind: 'writes', boundary: 'persistence' },
  { id: 'publish', source: 'a', target: 'topic', kind: 'publishes', boundary: 'async' },
  { id: 'owns', source: 'team', target: 'a', kind: 'owns' },
];

test('runs isolated prototypes in roadmap order', () => {
  assert.deepEqual(edgePrototypeStages.map((item) => item.id), [1, 2, 3, 4, 5]);
});

test('stage 1 labels only selected, path, and delta edges', () => {
  const result = buildEdgePrototype(edges, 1, { selectedEdgeId: 'call-a', pathEdgeIds: new Set(['call-b']), deltaEdgeIds: new Set(['write']) });
  assert.equal(result.get('call-a')?.labelReason, 'selected');
  assert.equal(result.get('call-b')?.labelReason, 'path');
  assert.equal(result.get('write')?.labelReason, 'delta');
  assert.equal(result.get('publish')?.showLabel, false);
});

test('stage 2 assigns ports by relation and boundary semantics', () => {
  const result = buildEdgePrototype(edges, 2);
  assert.equal(result.get('call-a')?.sourcePort.handle, 'control-out');
  assert.equal(result.get('write')?.targetPort.handle, 'data-in');
  assert.equal(result.get('publish')?.sourcePort.handle, 'async-out');
  assert.equal(result.get('owns')?.targetPort.handle, 'ownership-in');
});

test('stage 3 highlights path edges and shares trunks without merging evidence', () => {
  const result = buildEdgePrototype(edges, 3, { pathEdgeIds: new Set(['call-a', 'call-b']) });
  assert.equal(result.get('call-a')?.pathHighlighted, true);
  assert.equal(result.get('call-a')?.trunkId, result.get('call-b')?.trunkId);
  assert.equal(result.get('call-a')?.trunkRole, 'target');
  assert.equal(result.get('call-b')?.trunkRole, 'source');
  assert.equal(result.get('call-a')?.routing, 'trunk');
  assert.notEqual(result.get('call-a')?.edgeId, result.get('call-b')?.edgeId);
});

test('stage 4 uses deterministic relation lanes and orthogonal routing', () => {
  const result = buildEdgePrototype(edges, 4);
  assert.equal(result.get('call-a')?.lane, 0);
  assert.equal(result.get('write')?.lane, 1);
  assert.equal(result.get('publish')?.lane, 2);
  assert.equal(result.get('owns')?.lane, 3);
  assert.ok([...result.values()].every((item) => item.routing === 'orthogonal'));
});

test('stage 5 bundles only an existing true aggregate and retains canonical evidence mapping', () => {
  const aggregate: SysEdge = { id: 'aggregate', source: 'a', target: 'b', kind: 'calls', underlyingCount: 2, canonicalEdgeIds: ['call-b', 'call-a'], evidenceRefs: ['code-b', 'code-a'] };
  const ordinary: SysEdge = { ...aggregate, id: 'ordinary', underlyingCount: 1 };
  const result = buildEdgePrototype([aggregate, ordinary], 5, { selectedEdgeId: 'aggregate' });
  assert.deepEqual(result.get('aggregate')?.bundle, { count: 2, canonicalEdgeIds: ['call-a', 'call-b'], evidenceRefs: ['code-a', 'code-b'] });
  assert.match(result.get('aggregate')?.label ?? '', /×2$/);
  assert.equal(result.get('ordinary')?.bundle, undefined);
});

test('measures crossings, direction, hit target, comprehension, layout time, and keeps Dagre without material evidence', () => {
  const positioned = new Map([
    ['a', { id: 'a', x: 0, y: 0, width: 20, height: 20 }],
    ['b', { id: 'b', x: 100, y: 100, width: 20, height: 20 }],
    ['c', { id: 'c', x: 200, y: 100, width: 20, height: 20 }],
    ['db', { id: 'db', x: 100, y: 0, width: 20, height: 20 }],
    ['topic', { id: 'topic', x: 200, y: 0, width: 20, height: 20 }],
    ['team', { id: 'team', x: -100, y: 0, width: 20, height: 20 }],
  ]);
  const presentations = buildEdgePrototype(edges, 5, { selectedEdgeId: 'call-a', pathEdgeIds: new Set(['call-a', 'call-b']) });
  const metrics = measureEdgePrototype({ edges, positions: positioned, presentations, stage: 5, layoutTimeMs: 4.25, hitTargetWidth: 20 });
  assert.equal(typeof metrics.crossingCount.baseline, 'number');
  assert.equal(typeof metrics.crossingCount.prototype, 'number');
  assert.equal(metrics.directionRecognition, 1);
  assert.equal(metrics.clickAccuracy, 1);
  assert.equal(metrics.focalPathComprehension, 1);
  assert.equal(metrics.layoutTimeMs, 4.25);
  assert.equal(metrics.routingDecision, 'retain-dagre');
});

test('considers ELK only after every material-benefit gate passes', () => {
  const candidate = { stage: 5 as const, baselineCrossings: 8, prototypeCrossings: 5, directionRecognition: 0.95, clickAccuracy: 1, focalPathComprehension: 1, layoutTimeMs: 40 };
  assert.equal(routingDecision(candidate), 'evaluate-elk');
  assert.equal(routingDecision({ ...candidate, stage: 4 }), 'retain-dagre');
  assert.equal(routingDecision({ ...candidate, prototypeCrossings: 7 }), 'retain-dagre');
  assert.equal(routingDecision({ ...candidate, layoutTimeMs: 51 }), 'retain-dagre');
});
