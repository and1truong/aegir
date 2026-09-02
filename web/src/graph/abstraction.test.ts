import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvidenceRecord, SysEdge, SysNode } from '../data/types.ts';
import { abstractGraph } from './abstraction.ts';
import { createGraphIndex } from './index.ts';

const nodes: SysNode[] = [
  { id: 'svc-a', kind: 'service', label: 'A' }, { id: 'svc-b', kind: 'service', label: 'B' },
  { id: 'pkg-a', kind: 'package', label: 'a/pkg', service: 'svc-a' }, { id: 'pkg-b', kind: 'package', label: 'b/pkg', service: 'svc-b' },
  { id: 'a1', kind: 'function', label: 'A1', service: 'svc-a', pkg: 'pkg-a' }, { id: 'a2', kind: 'function', label: 'A2', service: 'svc-a', pkg: 'pkg-a' }, { id: 'b1', kind: 'function', label: 'B1', service: 'svc-b', pkg: 'pkg-b' },
];
const edges: SysEdge[] = [
  { id: 'a1|calls|b1', source: 'a1', target: 'b1', kind: 'calls' },
  { id: 'a2|calls|b1', source: 'a2', target: 'b1', kind: 'calls' },
];
const evidence: EvidenceRecord[] = edges.map((edge, index) => ({ id: `e${index}`, source: 'CODE', strength: 'proven', subject: { kind: 'edge', id: edge.id }, summary: edge.id }));

test('folds service relationships while retaining canonical membership and evidence', () => {
  const graph = abstractGraph(createGraphIndex(nodes, edges, evidence), 'service');
  assert.deepEqual(graph.index.nodes.map((node) => node.id), ['svc-a', 'svc-b']);
  assert.equal(graph.index.edges.length, 1);
  assert.equal(graph.index.edges[0].underlyingCount, 2);
  assert.deepEqual(graph.representativeEdgeMembers.get(graph.index.edges[0].id), edges.map((edge) => edge.id));
  assert.equal(graph.index.evidenceBySubject.get(`edge:${graph.index.edges[0].id}`)?.length, 2);
  assert.equal(graph.canonicalToRepresentative.get('a1'), 'svc-a');
});

test('component level falls back to package without inventing components', () => {
  const graph = abstractGraph(createGraphIndex(nodes, edges, evidence), 'component');
  assert.equal(graph.canonicalToRepresentative.get('a1'), 'pkg-a');
  assert.equal(graph.index.nodeById.has('component:a'), false);
});

test('keeps a canonical focal identity mappable across shortcut levels', () => {
  const index = createGraphIndex(nodes, edges, evidence);
  assert.equal(abstractGraph(index, 'service').canonicalToRepresentative.get('a1'), 'svc-a');
  assert.equal(abstractGraph(index, 'component').canonicalToRepresentative.get('a1'), 'pkg-a');
  assert.equal(abstractGraph(index, 'package').canonicalToRepresentative.get('a1'), 'pkg-a');
  assert.equal(abstractGraph(index, 'symbol').canonicalToRepresentative.get('a1'), 'a1');
});
