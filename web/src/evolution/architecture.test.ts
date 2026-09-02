import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphDelta } from '../data/types.ts';
import type { StructuralAnalytics } from '../analytics/structural.ts';
import { analyzeArchitectureEvolution } from './architecture.ts';

const analytics = (side: 'base' | 'head'): StructuralAnalytics => ({
  version: 1,
  snapshot: { repositoryId: 'repo', snapshotId: side === 'base' ? 1 : 2 },
  scope: { abstraction: 'service', edgeKinds: ['calls'], nodeCount: 3, edgeCount: side === 'base' ? 1 : 3, centralitySourceLimit: 3 },
  definitions: [],
  nodes: [
    { nodeId: 'a', fanIn: 0, fanOut: side === 'base' ? 1 : 2, coupling: side === 'base' ? 1 : 2, dependencyDepth: 0, ownershipBoundaryDensity: side === 'base' ? 0 : 0.5, boundedBetweenness: 0, edgeIds: side === 'base' ? ['ab'] : ['ab', 'ac'], evidenceIds: ['e'] },
    { nodeId: 'b', fanIn: side === 'base' ? 1 : 2, fanOut: side === 'base' ? 0 : 1, coupling: side === 'base' ? 1 : 2, dependencyDepth: 1, ownershipBoundaryDensity: 0, boundedBetweenness: 1, edgeIds: side === 'base' ? ['ab'] : ['ab', 'bc'], evidenceIds: [] },
    { nodeId: 'c', fanIn: side === 'base' ? 0 : 1, fanOut: side === 'base' ? 0 : 1, coupling: side === 'base' ? 0 : 2, dependencyDepth: side === 'base' ? 0 : 1, ownershipBoundaryDensity: 0, boundedBetweenness: 0, edgeIds: side === 'base' ? [] : ['ac', 'bc'], evidenceIds: [] },
  ],
  cycles: side === 'base' ? [] : [{ id: 'cycle', nodeIds: ['b', 'c'], edgeIds: ['bc', 'cb'] }],
  ownershipBoundaryDensity: side === 'base' ? 0 : 1 / 3,
});

const delta: GraphDelta = {
  edges: [{ id: 'ac', status: 'added', after: { id: 'ac', source: 'a', target: 'c', kind: 'calls', evidenceRefs: ['e'] }, changeReasons: [{ kind: 'dependency-added', detail: '', evidenceRefs: ['e'] }] }],
  nodes: [{ id: 'a', status: 'modified', before: { id: 'a', kind: 'service', label: 'A' }, after: { id: 'a', kind: 'service', label: 'A' }, changeReasons: [
    { kind: 'ownership-changed', detail: 'Team one → team two.' },
    { kind: 'complexity-changed', detail: 'Complexity score 3 → 8; cyclomatic 4 → 12.' },
    { kind: 'test-protection-changed', detail: 'Test protection covered (2 tests) → uncovered (0 tests).' },
  ] }],
};

test('ranks meaningful architecture changes and links them to graph evidence', () => {
  const result = analyzeArchitectureEvolution({ delta, base: analytics('base'), head: analytics('head') });
  assert.equal(result.changes[0].kind, 'cycle');
  assert.ok(result.changes.some((change) => change.kind === 'dependency' && change.edgeIds[0] === 'ac' && change.evidenceIds[0] === 'e'));
  assert.ok(result.changes.some((change) => change.kind === 'coupling' && change.nodeIds[0] === 'a'));
  assert.ok(result.changes.some((change) => change.kind === 'boundary-density'));
  assert.ok(result.changes.some((change) => change.kind === 'ownership'));
  assert.ok(result.changes.some((change) => change.kind === 'complexity' && change.direction === 'increased'));
  assert.ok(result.changes.some((change) => change.kind === 'test-protection' && change.direction === 'decreased'));
  assert.equal(result.changes.some((change) => change.title.includes('node count')), false);
});

test('refuses cross-abstraction metric comparison but keeps direct deltas', () => {
  const head = analytics('head');
  head.scope.abstraction = 'package';
  const result = analyzeArchitectureEvolution({ delta, base: analytics('base'), head });
  assert.equal(result.comparable, false);
  assert.ok(result.warnings[0].includes('abstraction'));
  assert.ok(result.changes.some((change) => change.kind === 'dependency'));
  assert.equal(result.changes.some((change) => change.kind === 'coupling'), false);
});

