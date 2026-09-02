import assert from 'node:assert/strict';
import test from 'node:test';
import type { EdgeKind, SysEdge, SysNode } from '../../data/types';
import { createGraphIndex } from '../index.ts';
import { projectionDefinition, projectionDefinitions, questionProjectionIds, signalProjectionIds } from './definitions.ts';
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

test('changes revision when the visible topology changes', () => {
  const before = projectVisibleGraph(createGraphIndex([node('root'), node('before')], [edge('root', 'before')]), projectionDefinition('dependencies'), { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1 });
  const after = projectVisibleGraph(createGraphIndex([node('root'), node('after')], [edge('root', 'after')]), projectionDefinition('dependencies'), { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1 });
  assert.notEqual(before.revision, after.revision);
});

test('registers every compatibility projection with declarative policies', () => {
  assert.deepEqual(signalProjectionIds.sort(), ['complexity', 'contracts', 'coverage', 'data flow', 'dependencies', 'impact', 'lint', 'runtime']);
  assert.equal(questionProjectionIds.length, 7);
  for (const definition of Object.values(projectionDefinitions)) {
    assert.ok(definition.relationshipPolicy.defaultKinds.length > 0);
    assert.deepEqual(definition.defaultDepth, { upstream: 1, downstream: 2 });
  }
});

test('question presets share depth and budget semantics and degrade missing evidence explicitly', () => {
  const nodes = [node('root'), node('target', 'external')];
  const edges = [edge('root', 'target')];
  const index = createGraphIndex(nodes, edges);
  for (const id of questionProjectionIds) {
    const graph = projectVisibleGraph(index, projectionDefinition(id), { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1, nodeBudget: 10 });
    assert.ok(graph.stats.visibleReal <= 10, id);
    assert.equal(graph.projectionId, id);
  }
  assert.ok(projectVisibleGraph(index, projectionDefinition('hot-path'), { activeNodeId: 'root' }).warnings.some((warning) => warning.code === 'missing-evidence'));
  assert.ok(projectVisibleGraph(index, projectionDefinition('cross-team-dependencies'), { activeNodeId: 'root' }).warnings.some((warning) => warning.code === 'missing-evidence'));
});

test('drills one high-fan-in service through package groups without exposing siblings', () => {
  const services = ['payments', 'checkout', 'fulfillment'].map((id) => node(id, 'service'));
  const callers = services.flatMap((service) => Array.from({ length: 8 }, (_, position) => ({
    id: `${service.id}-${position}`,
    kind: 'function' as const,
    label: `${service.id}-${position}`,
    service: service.id,
    pkg: `${service.id}-pkg-${position % 2}`,
  })));
  const root = node('utility');
  const edges = callers.map((caller) => edge(caller.id, root.id));
  const index = createGraphIndex([root, ...services, ...callers], edges);
  const collapsed = projectVisibleGraph(index, projectionDefinition('dependencies'), { activeNodeId: root.id, upstreamDepth: 1, downstreamDepth: 0, branchLimit: 4 });
  const paymentGroup = collapsed.nodes.find((item) => item.kind === 'frontier' && item.frontier.value === 'payments');
  assert.equal(paymentGroup?.kind, 'frontier');
  assert.deepEqual(realIds(collapsed), ['utility']);
  const serviceExpanded = projectVisibleGraph(index, projectionDefinition('dependencies'), { activeNodeId: root.id, upstreamDepth: 1, downstreamDepth: 0, branchLimit: 4, frontierExpansions: { [paymentGroup!.id]: 1 } });
  const packageGroup = serviceExpanded.nodes.find((item) => item.kind === 'frontier' && item.frontier.parentFrontierId === paymentGroup!.id);
  assert.equal(packageGroup?.kind, 'frontier');
  const leafExpanded = projectVisibleGraph(index, projectionDefinition('dependencies'), { activeNodeId: root.id, upstreamDepth: 1, downstreamDepth: 0, branchLimit: 4, frontierExpansions: { [paymentGroup!.id]: 1, [packageGroup!.id]: 1 } });
  assert.ok(realIds(leafExpanded).some((id) => id.startsWith('payments-')));
  assert.ok(realIds(leafExpanded).every((id) => id === 'utility' || id.startsWith('payments-')));
  assert.ok(leafExpanded.nodes.length <= 40);
});

test('pins reserve visible budget independently of the focal traversal', () => {
  const nodes = [node('root'), node('next'), node('reference'), node('missing-context')];
  const graph = projectVisibleGraph(createGraphIndex(nodes, [edge('root', 'next')]), projectionDefinition('dependencies'), { activeNodeId: 'root', pinnedNodeIds: ['reference'], upstreamDepth: 0, downstreamDepth: 1, nodeBudget: 3 });
  assert.deepEqual(realIds(graph), ['root', 'next', 'reference']);
  assert.equal(graph.nodes.find((item) => item.id === 'reference')?.reason.kind, 'pin');
  assert.ok(graph.revision.includes('pins:reference'));
});

test('shared directional candidates do not consume free unique-node slots', () => {
  const nodes = [node('root'), node('b'), node('c')];
  const edges = [edge('b', 'root'), edge('root', 'b'), edge('root', 'c')];
  const graph = projectVisibleGraph(createGraphIndex(nodes, edges), projectionDefinition('dependencies'), { activeNodeId: 'root', upstreamDepth: 1, downstreamDepth: 1, nodeBudget: 3 });
  assert.deepEqual(realIds(graph), ['root', 'b', 'c']);
});

test('collapsed groups still enqueue members visible from the opposite direction', () => {
  const grouped = ['b', ...Array.from({ length: 8 }, (_, index) => `s${index}`)].map((id) => ({ ...node(id), service: 'shared' }));
  const nodes = [node('root'), node('c'), ...grouped];
  const edges = [edge('b', 'root'), edge('root', 'b'), edge('b', 'c'), ...grouped.slice(1).map((item) => edge('root', item.id))];
  const graph = projectVisibleGraph(createGraphIndex(nodes, edges), projectionDefinition('dependencies'), { activeNodeId: 'root', upstreamDepth: 1, downstreamDepth: 2, branchLimit: 4, nodeBudget: 3 });
  assert.deepEqual(realIds(graph), ['root', 'c', 'b']);
});

test('collapsed child groups still enqueue members visible from the opposite direction', () => {
  const grouped = ['b', ...Array.from({ length: 8 }, (_, index) => `s${index}`)].map((id, index) => ({ ...node(id), service: 'shared', pkg: index < 5 ? 'first' : 'second' }));
  const nodes = [node('root'), node('c'), ...grouped];
  const edges = [edge('b', 'root'), edge('root', 'b'), edge('b', 'c'), ...grouped.slice(1).map((item) => edge('root', item.id))];
  const index = createGraphIndex(nodes, edges);
  const collapsed = projectVisibleGraph(index, projectionDefinition('dependencies'), { activeNodeId: 'root', upstreamDepth: 1, downstreamDepth: 2, branchLimit: 4, nodeBudget: 3 });
  const serviceGroup = collapsed.nodes.find((item) => item.kind === 'frontier' && item.frontier.value === 'shared');
  assert.equal(serviceGroup?.kind, 'frontier');
  const graph = projectVisibleGraph(index, projectionDefinition('dependencies'), { activeNodeId: 'root', upstreamDepth: 1, downstreamDepth: 2, branchLimit: 4, nodeBudget: 3, frontierExpansions: { [serviceGroup!.id]: 1 } });
  assert.deepEqual(realIds(graph), ['root', 'c', 'b']);
});

test('locked paths reserve ordered entities and expose stale segments', () => {
  const nodes = [node('root'), node('middle'), node('target'), node('noise')];
  const edges = [edge('root', 'middle'), edge('middle', 'target'), edge('root', 'noise')];
  const index = createGraphIndex(nodes, edges);
  const graph = projectVisibleGraph(index, projectionDefinition('dependencies'), { activeNodeId: 'noise', requiredNodeIds: ['root', 'middle', 'target'], requiredEdgeIds: ['root:calls:middle', 'middle:calls:target'], upstreamDepth: 0, downstreamDepth: 0, nodeBudget: 4, edgeKinds: new Set(), evidencePolicy: { maximumLevel: 'proven', includeStale: false } });
  assert.deepEqual(realIds(graph), ['root', 'middle', 'target', 'noise']);
  assert.equal(graph.nodes.find((item) => item.id === 'middle')?.reason.kind, 'locked-path');
  const pathEdges = graph.edges.filter((item) => item.kind === 'real');
  assert.deepEqual(pathEdges.map((item) => item.id), ['root:calls:middle', 'middle:calls:target']);
  assert.ok(pathEdges.every((item) => item.broken));
  assert.ok(graph.revision.includes('path:root:calls:middle,middle:calls:target'));
});

test('locked paths report missing segments without dropping surviving nodes', () => {
  const graph = projectVisibleGraph(createGraphIndex([node('root')], []), projectionDefinition('dependencies'), { activeNodeId: 'root', requiredNodeIds: ['missing'], requiredEdgeIds: ['missing-edge'] });
  assert.ok(graph.warnings.some((warning) => warning.code === 'broken-path' && warning.message.includes('2 missing segments')));
  assert.deepEqual(realIds(graph), ['root']);
});
