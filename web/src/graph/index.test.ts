import assert from 'node:assert/strict';
import test from 'node:test';
import type { SysEdge, SysNode } from '../data/types';
import { createGraphIndex } from './index.ts';

const nodes: SysNode[] = [
  { id: 'a', kind: 'service', label: 'A' },
  { id: 'b', kind: 'function', label: 'B', service: 'a', pkg: 'pkg', owner: 'team' },
];

test('indexes canonical direction, adjacency, and membership once', () => {
  const edges: SysEdge[] = [
    { id: 'call', source: 'a', target: 'b', kind: 'calls' },
    { id: 'dangling', source: 'b', target: 'missing', kind: 'calls' },
  ];
  const index = createGraphIndex(nodes, edges);
  assert.deepEqual(index.outgoingByNode.get('a'), ['call']);
  assert.deepEqual(index.incomingByNode.get('b'), ['call']);
  assert.deepEqual(index.adjacentByNode.get('b'), ['call']);
  assert.equal(index.edgeById.has('dangling'), false);
  assert.deepEqual(index.membership.get('b'), { service: 'a', pkg: 'pkg', owner: 'team' });
});

test('keeps deterministic edge order in every adjacency view', () => {
  const edges: SysEdge[] = [
    { id: 'z', source: 'a', target: 'b', kind: 'writes' },
    { id: 'a', source: 'a', target: 'b', kind: 'calls' },
  ];
  const index = createGraphIndex(nodes, edges);
  assert.deepEqual(index.adjacentByNode.get('a'), ['a', 'z']);
});
