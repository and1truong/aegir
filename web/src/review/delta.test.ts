import assert from 'node:assert/strict';
import test from 'node:test';
import type { SysEdge, SysNode } from '../data/types.ts';
import { adaptGraphDelta, graphForReviewPolicy } from './delta.ts';

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
