import assert from 'node:assert/strict';
import test from 'node:test';
import type { EdgeKind, SysEdge, SysNode } from '../../data/types';
import { createGraphIndex } from '../index.ts';
import { projectionDefinition, projectionDefinitions } from './definitions.ts';
import { frontierId, projectVisibleGraph } from './engine.ts';

const node = (id: string, kind: SysNode['kind'] = 'function'): SysNode => ({ id, kind, label: id });
const edge = (source: string, target: string, kind: EdgeKind = 'calls'): SysEdge => ({ id: `${source}:${kind}:${target}`, source, target, kind });
const realIds = (graph: ReturnType<typeof projectVisibleGraph>) => graph.nodes.flatMap((item) => item.kind === 'real' ? [item.id] : []);

test('returns typed reasons for every visible real entity', () => {
  const index = createGraphIndex([node('root'), node('next')], [edge('root', 'next')]);
  const graph = projectVisibleGraph(index, projectionDefinition('dependencies'), { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1 });
  const next = graph.nodes.find((item) => item.id === 'next');
  assert.equal(next?.kind, 'real');
  assert.equal(next?.reason.kind, 'traversal');
  assert.equal(next?.reason.kind === 'traversal' ? next.reason.semanticDepth : undefined, 1);
  assert.ok(graph.edges.every((item) => item.reason.detail.length > 0));
  assert.ok(graph.edges.every((item) => item.kind !== 'real' || item.evidenceIds.length > 0));
});

test('represents overflow as frontier variants, not canonical-looking nodes or edges', () => {
  const nodes = [node('root'), ...Array.from({ length: 7 }, (_, index) => node(`n${index}`))];
  const edges = nodes.slice(1).map((item) => edge('root', item.id));
  const graph = projectVisibleGraph(createGraphIndex(nodes, edges), projectionDefinition('dependencies'), { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1, branchLimit: 2 });
  const frontier = graph.nodes.find((item) => item.kind === 'frontier');
  assert.equal(frontier?.kind, 'frontier');
  assert.equal(frontier?.kind === 'frontier' ? frontier.frontier.hiddenCount : undefined, 5);
  assert.ok(graph.edges.some((item) => item.kind === 'frontier-link' && item.canonicalEdgeIds.length === 0));
  assert.ok(graph.nodes.every((item) => item.kind !== 'real' || !item.id.startsWith('aggregate:')));
});

test('frontier expansion is local and can explicitly cross a depth boundary', () => {
  const nodes = [node('root'), node('middle'), node('beyond')];
  const edges = [edge('root', 'middle'), edge('middle', 'beyond')];
  const id = frontierId('middle', 'downstream', 'downstream dependencies');
  const collapsed = projectVisibleGraph(createGraphIndex(nodes, edges), projectionDefinition('dependencies'), { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1 });
  assert.deepEqual(realIds(collapsed), ['root', 'middle']);
  const expanded = projectVisibleGraph(createGraphIndex(nodes, edges), projectionDefinition('dependencies'), { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1, frontierExpansions: { [id]: 1 } });
  assert.deepEqual(realIds(expanded), ['root', 'middle', 'beyond']);
});

test('uses explicit visual direction for consumed events', () => {
  const nodes = [node('consumer'), node('topic', 'topic')];
  const edges = [edge('consumer', 'topic', 'consumes')];
  const graph = projectVisibleGraph(createGraphIndex(nodes, edges), projectionDefinition('data flow'), { activeNodeId: 'topic', upstreamDepth: 0, downstreamDepth: 1 });
  assert.deepEqual(realIds(graph), ['consumer', 'topic']);
  assert.deepEqual(graph.edges.map(({ source, target }) => [source, target]), [['topic', 'consumer']]);
});

test('reports missing roots and accounts for the hard budget deterministically', () => {
  const nodes = Array.from({ length: 60 }, (_, index) => node(`n${index}`, 'package'));
  const index = createGraphIndex(nodes, []);
  const missing = projectVisibleGraph(index, projectionDefinition('dependencies'), { activeNodeId: 'missing', nodeBudget: 30 });
  assert.ok(missing.warnings.some((warning) => warning.code === 'missing-root'));
  assert.equal(missing.stats.visibleReal, 30);
  const again = projectVisibleGraph(index, projectionDefinition('dependencies'), { activeNodeId: 'missing', nodeBudget: 30 });
  assert.equal(missing.revision, again.revision);
  assert.deepEqual(realIds(missing), realIds(again));
});

test('registers every compatibility projection with declarative policies', () => {
  assert.deepEqual(Object.keys(projectionDefinitions).sort(), ['complexity', 'contracts', 'coverage', 'data flow', 'dependencies', 'impact', 'lint', 'review', 'runtime']);
  for (const definition of Object.values(projectionDefinitions)) {
    assert.ok(definition.relationshipPolicy.defaultKinds.length > 0);
    assert.deepEqual(definition.defaultDepth, { upstream: 1, downstream: 2 });
  }
});
