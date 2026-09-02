import assert from 'node:assert/strict';
import test from 'node:test';
import type { SysNode } from '../../data/types.ts';
import { createGraphIndex } from '../index.ts';
import { projectionDefinitions } from './definitions.ts';
import { groupingValue } from './groupingDimensions.ts';

const nodes: SysNode[] = [{ id: 'topic', kind: 'topic', label: 'orders', owner: 'payments' }, { id: 'handler', kind: 'function', label: 'Handle', service: 'svc' }];
const index = createGraphIndex(nodes, [], [], { telemetry: [{ nodeId: 'handler', rpm: 1400 }] });

test('shared dimensions extract topic, team, access, and traffic values', () => {
  assert.equal(groupingValue('topic', index, { nodeId: 'topic', relation: 'consumes', score: 1, evidenceIds: [], withinDepth: true }), 'topic');
  assert.equal(groupingValue('team', index, { nodeId: 'topic', relation: 'consumes', score: 1, evidenceIds: [], withinDepth: true }), 'payments');
  assert.equal(groupingValue('access', index, { nodeId: 'handler', relation: 'writes', score: 1, evidenceIds: [], withinDepth: true }), 'writes');
  assert.equal(groupingValue('traffic', index, { nodeId: 'handler', relation: 'calls', score: 1, evidenceIds: [], withinDepth: true }), 'high');
});

test('question presets select reusable grouping sequences declaratively', () => {
  assert.deepEqual(projectionDefinitions['hot-path'].groupingDimensions.slice(0, 2), ['traffic', 'service']);
  assert.deepEqual(projectionDefinitions['cross-team-dependencies'].groupingDimensions.slice(0, 2), ['team', 'service']);
  assert.equal(projectionDefinitions['state-mutation'].groupingDimensions[0], 'access');
});
