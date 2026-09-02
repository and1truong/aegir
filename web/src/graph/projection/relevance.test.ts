import assert from 'node:assert/strict';
import test from 'node:test';
import type { SysEdge, SysNode } from '../../data/types';
import { createGraphIndex } from '../index.ts';
import { projectionDefinition } from './definitions.ts';
import { compareCandidates, scoreCandidate, type RelevanceCandidate } from './relevance.ts';

const root: SysNode = { id: 'root', kind: 'function', label: 'Root', owner: 'team-a' };
const edge = (target: string, pr?: SysEdge['pr']): SysEdge => ({ id: `root:calls:${target}`, source: 'root', target, kind: 'calls', pr });

test('changed and direct semantic candidates outrank structural popularity', () => {
  const changed: SysNode = { id: 'changed', kind: 'function', label: 'Changed', pr: 'added' };
  const popular: SysNode = { id: 'popular', kind: 'function', label: 'Popular' };
  const leaves = Array.from({ length: 15 }, (_, index) => ({ id: `leaf-${index}`, kind: 'function' as const, label: `Leaf ${index}` }));
  const edges = [edge('changed', 'added'), edge('popular'), ...leaves.map((leaf) => ({ id: `popular:calls:${leaf.id}`, source: 'popular', target: leaf.id, kind: 'calls' as const }))];
  const index = createGraphIndex([root, changed, popular, ...leaves], edges);
  const definition = projectionDefinition('review');
  const changedCandidate: RelevanceCandidate = { node: changed, edge: edges[0], fromNodeId: root.id, semanticDepth: 1 };
  const popularCandidate: RelevanceCandidate = { node: popular, edge: edges[1], fromNodeId: root.id, semanticDepth: 1 };
  const changedScore = scoreCandidate(index, definition, changedCandidate);
  const popularScore = scoreCandidate(index, definition, popularCandidate);
  assert.ok(changedScore.total > popularScore.total);
  assert.ok(compareCandidates({ ...changedCandidate, score: changedScore }, { ...popularCandidate, score: popularScore }) < 0);
});

test('runtime uses bounded log scaling and exposes contribution details', () => {
  const hot: SysNode = { id: 'hot', kind: 'function', label: 'Hot' };
  const call = edge('hot');
  const index = createGraphIndex([root, hot], [call], [], { telemetry: [{ nodeId: 'hot', rpm: 1_000_000, p99: 5_000, errorRate: 50 }] });
  const score = scoreCandidate(index, projectionDefinition('runtime'), { node: hot, edge: call, fromNodeId: root.id, semanticDepth: 1 });
  const runtime = score.components.find((item) => item.signal === 'runtime');
  assert.equal(runtime?.normalized, 1);
  assert.ok(score.reason.includes('direct'));
});

test('ties use semantic depth, relation, kind, label, then stable id', () => {
  const a: SysNode = { id: 'a', kind: 'function', label: 'A' };
  const b: SysNode = { id: 'b', kind: 'function', label: 'B' };
  const edges = [edge('a'), edge('b')];
  const index = createGraphIndex([root, a, b], edges);
  const definition = projectionDefinition('dependencies');
  const candidates = [a, b].map((node, position) => {
    const candidate = { node, edge: edges[position], fromNodeId: root.id, semanticDepth: 1 };
    return { ...candidate, score: scoreCandidate(index, definition, candidate) };
  });
  assert.deepEqual(candidates.sort(compareCandidates).map((item) => item.node.id), ['a', 'b']);
});
