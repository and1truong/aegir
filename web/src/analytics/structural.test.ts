import assert from 'node:assert/strict';
import test from 'node:test';
import type { SysEdge, SysNode } from '../data/types.ts';
import { computeStructuralAnalytics, rankStructuralHotspots } from './structural.ts';

const nodes: SysNode[] = [
  { id: 'a', kind: 'service', label: 'A', owner: 'one' },
  { id: 'b', kind: 'service', label: 'B', owner: 'one' },
  { id: 'c', kind: 'service', label: 'C', owner: 'two' },
  { id: 'd', kind: 'service', label: 'D', owner: 'two' },
];
const edges: SysEdge[] = [
  { id: 'ab', source: 'a', target: 'b', kind: 'calls', evidenceRefs: ['e1'] },
  { id: 'ac', source: 'a', target: 'c', kind: 'calls' },
  { id: 'bc', source: 'b', target: 'c', kind: 'depends_on' },
  { id: 'cd', source: 'c', target: 'd', kind: 'calls' },
  { id: 'db', source: 'd', target: 'b', kind: 'calls' },
];

test('computes known structural metrics with versioned scope', () => {
  const analytics = computeStructuralAnalytics({ repositoryId: 'repo', snapshotId: 7, abstraction: 'service', nodes, edges });
  const byId = new Map(analytics.nodes.map((node) => [node.nodeId, node]));
  assert.equal(analytics.version, 1);
  assert.equal(analytics.scope.abstraction, 'service');
  assert.equal(byId.get('a')?.fanOut, 2);
  assert.equal(byId.get('b')?.fanIn, 2);
  assert.equal(byId.get('c')?.coupling, 3);
  assert.equal(byId.get('d')?.dependencyDepth, 2);
  assert.deepEqual(analytics.cycles.map((cycle) => cycle.nodeIds), [['b', 'c', 'd']]);
  assert.equal(analytics.ownershipBoundaryDensity, 3 / 5);
  assert.deepEqual(byId.get('a')?.evidenceIds, ['e1']);
});

test('centrality remains bounded supporting context, not standalone truth', () => {
  const analytics = computeStructuralAnalytics({ repositoryId: 'repo', snapshotId: 7, abstraction: 'service', nodes, edges, centralitySourceLimit: 2 });
  const central = [...analytics.nodes].sort((left, right) => right.boundedBetweenness - left.boundedBetweenness)[0];
  const target = analytics.nodes.find((node) => node.nodeId !== central.nodeId)!;
  const ranking = rankStructuralHotspots(analytics, { complexityByNode: new Map([[target.nodeId, 10]]), changedNodeIds: new Set([target.nodeId]) });
  assert.equal(ranking[0].nodeId, target.nodeId);
  assert.ok(ranking.find((item) => item.nodeId === central.nodeId)!.contributions.centrality <= 1);
  assert.ok(ranking[0].edgeIds.length > 0);
});
