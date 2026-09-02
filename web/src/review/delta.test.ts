import assert from 'node:assert/strict';
import test from 'node:test';
import type { SysEdge, SysNode } from '../data/types.ts';
import { adaptGraphDelta, graphForReviewPolicy, graphForReviewSnapshot } from './delta.ts';

const nodes: SysNode[] = [{ id: 'a', kind: 'function', label: 'A', pr: 'modified' }, { id: 'b', kind: 'function', label: 'B' }, { id: 'c', kind: 'function', label: 'C' }];
const edges: SysEdge[] = [{ id: 'a|calls|b', source: 'a', target: 'b', kind: 'calls', pr: 'added' }, { id: 'b|calls|c', source: 'b', target: 'c', kind: 'calls' }];

test('adapts persisted v1 review markers into explicit delta entries', () => {
  const delta = adaptGraphDelta({ nodes, edges });
  assert.deepEqual(delta.nodes.map((entry) => [entry.id, entry.status]), [['a', 'modified']]);
  assert.deepEqual(delta.edges.map((entry) => [entry.id, entry.status]), [['a|calls|b', 'added']]);
  assert.equal(delta.nodes[0].changeReasons[0].kind, 'legacy-change');
});

test('changes-only keeps changed entities and required edge endpoints', () => {
  const delta = adaptGraphDelta({ nodes, edges });
  const graph = graphForReviewPolicy({ nodes, edges }, delta, 'changes-only');
  assert.deepEqual(graph.nodes.map((node) => node.id), ['a', 'b']);
  assert.deepEqual(graph.edges.map((edge) => edge.id), ['a|calls|b']);
});

test('changes plus impact retains unchanged context', () => {
  const delta = adaptGraphDelta({ nodes, edges });
  const graph = graphForReviewPolicy({ nodes, edges }, delta, 'changes-impact');
  assert.deepEqual(graph.nodes.map((node) => node.id), ['a', 'b', 'c']);
});

test('reconstructs base and head views from typed before and after bodies', () => {
  const before = { ...nodes[0], label: 'Before', pr: undefined };
  const after = { ...nodes[0], label: 'After', pr: undefined };
  const delta = { nodes: [{ id: 'a', status: 'modified' as const, before, after, changeReasons: [] }], edges: [{ id: edges[0].id, status: 'added' as const, after: edges[0], changeReasons: [] }] };
  assert.deepEqual(graphForReviewSnapshot({ nodes, edges }, delta, 'base').nodes.find((node) => node.id === 'a')?.label, 'Before');
  assert.equal(graphForReviewSnapshot({ nodes, edges }, delta, 'base').edges.some((edge) => edge.id === edges[0].id), false);
  assert.deepEqual(graphForReviewSnapshot({ nodes, edges }, delta, 'head').nodes.find((node) => node.id === 'a')?.label, 'After');
  assert.equal(graphForReviewSnapshot({ nodes, edges }, delta, 'head').edges.some((edge) => edge.id === edges[0].id), true);
});

test('keeps legacy modified bodies when the base side was not retained', () => {
  const legacyNodes: SysNode[] = [{ id: 'a', kind: 'function', label: 'Head A', pr: 'modified' }, { id: 'b', kind: 'function', label: 'B' }];
  const legacyEdges: SysEdge[] = [{ id: 'a|calls|b', source: 'a', target: 'b', kind: 'calls', label: 'head call', pr: 'modified' }];
  const review = { nodes: legacyNodes, edges: legacyEdges };
  const delta = adaptGraphDelta(review);
  assert.deepEqual(graphForReviewSnapshot(review, delta, 'base').nodes.map((node) => node.id), ['a', 'b']);
  const archived = { nodes: [{ ...legacyNodes[0], label: 'Base A' }, legacyNodes[1]], edges: [{ ...legacyEdges[0], label: 'base call' }] };
  const graph = graphForReviewSnapshot(review, delta, 'base', archived);
  assert.equal(graph.nodes.find((node) => node.id === 'a')?.label, 'Base A');
  assert.equal(graph.edges[0].label, 'base call');
});
