import assert from 'node:assert/strict';
import test from 'node:test';
import type { SysNode } from '../../data/types';
import { createGraphIndex } from '../index.ts';
import { groupFrontierCandidates } from './grouping.ts';

test('groups 127 callers by ranked service with a stable remainder', () => {
  const services: SysNode[] = ['payments', 'checkout', 'fulfillment', 'other-a', 'other-b', 'other-c', 'other-d'].map((id) => ({ id, kind: 'service', label: id }));
  const counts = [48, 31, 21, 10, 8, 5, 4];
  const callers = services.flatMap((service, serviceIndex) => Array.from({ length: counts[serviceIndex] }, (_, index) => ({ id: `${service.id}-${index}`, kind: 'function' as const, label: `${service.id}-${index}`, service: service.id })));
  const index = createGraphIndex([...services, ...callers], []);
  const groups = groupFrontierCandidates(index, callers.map((node, position) => ({ nodeId: node.id, relation: 'calls', score: 100 - position / 100, evidenceIds: [], withinDepth: true })), { parentId: 'utility', direction: 'upstream', category: 'callers', maxGroups: 5 });
  assert.equal(groups.length, 5);
  assert.equal(groups[0].value, 'payments');
  assert.equal(groups[0].hiddenCount, 48);
  assert.equal(groups.at(-1)?.dimension, 'remainder');
  assert.equal(groups.reduce((sum, group) => sum + group.hiddenCount, 0), 127);
  assert.deepEqual(groups, groupFrontierCandidates(index, callers.map((node, position) => ({ nodeId: node.id, relation: 'calls', score: 100 - position / 100, evidenceIds: [], withinDepth: true })), { parentId: 'utility', direction: 'upstream', category: 'callers', maxGroups: 5 }));
});

test('falls back from missing service to package grouping', () => {
  const nodes: SysNode[] = [{ id: 'a', kind: 'function', label: 'a', pkg: 'pkg-a' }, { id: 'b', kind: 'function', label: 'b', pkg: 'pkg-b' }];
  const groups = groupFrontierCandidates(createGraphIndex(nodes, []), nodes.map((node) => ({ nodeId: node.id, relation: 'calls', score: 1, evidenceIds: [], withinDepth: true })), { parentId: 'root', direction: 'downstream', category: 'calls' });
  assert.ok(groups.every((group) => group.dimension === 'package'));
});
