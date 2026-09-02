import assert from 'node:assert/strict';
import test from 'node:test';
import type { EdgeKind, EvidenceRecord, SysEdge, SysNode } from '../data/types.ts';
import { createGraphIndex } from '../graph/index.ts';
import { runPathQuery, type PathQueryId } from './query.ts';

const nodes: SysNode[] = [
  { id: 'create', kind: 'function', label: 'CreateOrder', pkg: 'orders' },
  { id: 'orders', kind: 'package', label: 'orders' },
  { id: 'event', kind: 'topic', label: 'order.created' },
  { id: 'payment', kind: 'function', label: 'PaymentConsumer' },
  { id: 'table', kind: 'table', label: 'orders' },
  { id: 'reader', kind: 'function', label: 'ReadOrder' },
  { id: 'dead', kind: 'external', label: 'Disconnected' },
];

function edge(id: string, source: string, target: string, kind: EdgeKind): SysEdge {
  return { id, source, target, kind };
}

function evidence(edges: readonly SysEdge[], runtime: readonly string[] = []): EvidenceRecord[] {
  return edges.map((item) => ({ id: `e:${item.id}`, source: runtime.includes(item.id) ? 'RUNTIME' : 'CODE', strength: runtime.includes(item.id) ? 'observed' : 'proven', subject: { kind: 'edge', id: item.id }, summary: item.id }));
}

const policy = { maximumLevel: 'inferred' as const, includeStale: true };

function query(definitionId: PathQueryId, sourceNodeId: string, targetNodeId: string, edges: SysEdge[], runtime: string[] = []) {
  return runPathQuery(createGraphIndex(nodes, edges, evidence(edges, runtime)), { definitionId, sourceNodeId, targetNodeId, evidencePolicy: policy, maxAlternatives: 2 });
}

test('explains the minimal CreateOrder to PaymentConsumer async route', () => {
  const edges = [edge('publish', 'create', 'event', 'publishes'), edge('consume', 'payment', 'event', 'consumes')];
  const result = query('semantic-dependency', 'create', 'payment', edges);
  assert.deepEqual(result.path?.nodeIds, ['create', 'event', 'payment']);
  assert.deepEqual(result.path?.edgeIds, ['publish', 'consume']);
  assert.equal(result.path?.semanticHops, 2);
  assert.match(result.path?.steps[1].explanation ?? '', /consumes/);
});

test('containment is bidirectional and costs no semantic hop', () => {
  const edges = [edge('owns', 'orders', 'create', 'owns'), edge('call', 'orders', 'payment', 'calls')];
  const result = query('semantic-dependency', 'create', 'payment', edges);
  assert.deepEqual(result.path?.edgeIds, ['owns', 'call']);
  assert.equal(result.path?.semanticHops, 1);
  assert.equal(result.path?.steps[0].semanticCost, 0);
});

test('containment cannot shortcut between sibling symbols', () => {
  const siblingNodes = [...nodes, { id: 'sibling', kind: 'function' as const, label: 'Sibling' }];
  const edges = [edge('owns-create', 'orders', 'create', 'owns'), edge('owns-sibling', 'orders', 'sibling', 'owns'), edge('real-call', 'create', 'sibling', 'calls')];
  const index = createGraphIndex(siblingNodes, edges, evidence(edges));
  const result = runPathQuery(index, { definitionId: 'semantic-dependency', sourceNodeId: 'create', targetNodeId: 'sibling', evidencePolicy: policy });
  assert.deepEqual(result.path?.edgeIds, ['real-call']);
  assert.equal(result.path?.semanticHops, 1);
});

test('runtime query distinguishes a runtime evidence gap from disconnection', () => {
  const edges = [edge('call', 'create', 'payment', 'calls')];
  assert.equal(query('runtime-observed', 'create', 'payment', edges).noPath?.code, 'runtime-evidence-gap');
  assert.deepEqual(query('runtime-observed', 'create', 'payment', edges, ['call']).path?.edgeIds, ['call']);
});

test('equal paths and cycles resolve deterministically with alternatives', () => {
  const edges = [
    edge('b1', 'create', 'orders', 'calls'), edge('b2', 'orders', 'payment', 'calls'),
    edge('a1', 'create', 'event', 'publishes'), edge('a2', 'payment', 'event', 'consumes'),
    edge('cycle', 'payment', 'create', 'calls'),
  ];
  const result = query('semantic-dependency', 'create', 'payment', edges);
  assert.deepEqual(result.path?.edgeIds, ['a1', 'a2']);
  assert.deepEqual(result.alternatives[0]?.edgeIds, ['b1', 'b2']);
});

test('failure and data policies use their explicit direction rules', () => {
  const failure = [edge('call', 'create', 'payment', 'calls')];
  assert.deepEqual(query('failure-propagation', 'payment', 'create', failure).path?.edgeIds, ['call']);
  const lineage = [edge('write', 'create', 'table', 'writes'), edge('read', 'reader', 'table', 'reads')];
  assert.deepEqual(query('data-lineage', 'create', 'reader', lineage).path?.edgeIds, ['write', 'read']);
});

test('reports endpoint and semantic-policy failures', () => {
  assert.equal(query('semantic-dependency', 'create', 'missing', []).noPath?.code, 'missing-endpoint');
  assert.equal(query('semantic-dependency', 'create', 'dead', []).noPath?.code, 'disconnected');
  assert.equal(query('semantic-dependency', 'create', 'create', []).noPath?.code, 'same-endpoint');
});
