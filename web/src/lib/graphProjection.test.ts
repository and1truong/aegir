import assert from 'node:assert/strict';
import test from 'node:test';
import type { EdgeKind, SysEdge, SysNode } from '../data/types';
import { branchKey, projectGraph, projectPRGraph } from './graphProjection.ts';

const node = (id: string, kind: SysNode['kind'] = 'function', pr?: SysNode['pr']): SysNode => ({ id, label: id, kind, pr });
const edge = (source: string, target: string, kind: EdgeKind = 'calls', pr?: SysEdge['pr']): SysEdge => ({ id: `${source}-${kind}-${target}`, source, target, kind, pr });
const ids = (projection: ReturnType<typeof projectGraph>) => projection.nodes.filter((item) => !item.id.startsWith('aggregate:')).map((item) => item.id);

test('traverses upstream and downstream independently', () => {
  const nodes = ['u2', 'u1', 'root', 'd1', 'd2', 'd3'].map((id) => node(id));
  const edges = [edge('u2', 'u1'), edge('u1', 'root'), edge('root', 'd1'), edge('d1', 'd2'), edge('d2', 'd3')];
  const projection = projectGraph(nodes, edges, { activeNodeId: 'root', upstreamDepth: 1, downstreamDepth: 2 });
  assert.deepEqual(ids(projection), ['u1', 'root', 'd1', 'd2']);
});

test('upstream depth does not leak into downstream traversal', () => {
  const nodes = ['u2', 'u1', 'root', 'd1'].map((id) => node(id));
  const projection = projectGraph(nodes, [edge('u2', 'u1'), edge('u1', 'root'), edge('root', 'd1')], { activeNodeId: 'root', upstreamDepth: 2, downstreamDepth: 0 });
  assert.deepEqual(ids(projection), ['u2', 'u1', 'root']);
});

test('downstream depth does not leak into upstream traversal', () => {
  const nodes = ['u1', 'root', 'd1', 'd2'].map((id) => node(id));
  const projection = projectGraph(nodes, [edge('u1', 'root'), edge('root', 'd1'), edge('d1', 'd2')], { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 2 });
  assert.deepEqual(ids(projection), ['root', 'd1', 'd2']);
});

test('depth zero keeps only the active node', () => {
  const projection = projectGraph([node('u'), node('root'), node('d')], [edge('u', 'root'), edge('root', 'd')], { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 0 });
  assert.deepEqual(ids(projection), ['root']);
});

test('containment wrappers do not consume a semantic hop', () => {
  const nodes = [node('root'), node('pkg', 'package'), node('dependency')];
  const projection = projectGraph(nodes, [edge('root', 'pkg', 'owns'), edge('pkg', 'dependency')], { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1 });
  assert.deepEqual(ids(projection), ['root', 'pkg', 'dependency']);
});

test('edge filtering limits traversal', () => {
  const nodes = [node('root'), node('called'), node('table', 'table')];
  const projection = projectGraph(nodes, [edge('root', 'called'), edge('root', 'table', 'reads')], { activeNodeId: 'root', edgeKinds: new Set<EdgeKind>(['reads']), upstreamDepth: 0, downstreamDepth: 1 });
  assert.deepEqual(ids(projection), ['root', 'table']);
});

test('aggregates large fan-out and expands only that branch', () => {
  const children = Array.from({ length: 12 }, (_, index) => node(`child-${String(index).padStart(2, '0')}`));
  const nodes = [node('root'), ...children];
  const edges = children.map((child) => edge('root', child.id));
  const collapsed = projectGraph(nodes, edges, { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1, branchLimit: 4, branchPageSize: 3 });
  assert.equal(ids(collapsed).length, 5);
  assert.equal(collapsed.aggregates[0]?.hiddenCount, 8);
  const key = branchKey('root', 'downstream', 'downstream dependencies');
  const expanded = projectGraph(nodes, edges, { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1, branchLimit: 4, branchPageSize: 3, branchExpansions: { [key]: 1 } });
  assert.equal(ids(expanded).length, 8);
  assert.equal(expanded.aggregates[0]?.hiddenCount, 5);
});

test('branch expansion overrides a depth frontier without changing global depth', () => {
  const nodes = [node('root'), node('d1'), node('d2'), node('sibling')];
  const edges = [edge('root', 'd1'), edge('d1', 'd2'), edge('root', 'sibling')];
  const key = branchKey('d1', 'downstream', 'downstream dependencies');
  const projection = projectGraph(nodes, edges, { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1, branchExpansions: { [key]: 1 } });
  assert.deepEqual(ids(projection), ['root', 'd1', 'd2', 'sibling']);
});

test('caps the default projection including frontier aggregates', () => {
  const children = Array.from({ length: 35 }, (_, index) => node(`child-${String(index).padStart(2, '0')}`));
  const grandchildren = children.map((child) => node(`grandchild-${child.id}`));
  const nodes = [node('root'), ...children, ...grandchildren];
  const edges = [
    ...children.map((child) => edge('root', child.id)),
    ...children.map((child, index) => edge(child.id, grandchildren[index].id)),
  ];
  const projection = projectGraph(nodes, edges, { activeNodeId: 'root', upstreamDepth: 0, downstreamDepth: 1, branchLimit: 35, nodeBudget: 30 });
  const visible = new Set(projection.nodes.map((item) => item.id));
  assert.equal(projection.nodes.length, 30);
  assert.equal(projection.nodes.length + projection.aggregates.length, 40);
  assert.ok(projection.edges.every((item) => visible.has(item.source) && visible.has(item.target)));
});

test('projection order stays deterministic when active node changes', () => {
  const nodes = [node('a'), node('b'), node('c'), node('d')];
  const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'd')];
  const first = projectGraph(nodes, edges, { activeNodeId: 'b', upstreamDepth: 1, downstreamDepth: 2 });
  const second = projectGraph(nodes, edges, { activeNodeId: 'c', upstreamDepth: 2, downstreamDepth: 1 });
  assert.deepEqual(ids(first), ['a', 'b', 'c', 'd']);
  assert.deepEqual(ids(second), ['a', 'b', 'c', 'd']);
});

test('PR projection starts from changed nodes and excludes unrelated nodes', () => {
  const nodes = [node('changed', 'function', 'modified'), node('impact'), node('unrelated')];
  const projection = projectPRGraph(nodes, [edge('changed', 'impact')], { upstreamDepth: 1, downstreamDepth: 1 });
  assert.deepEqual(ids(projection), ['changed', 'impact']);
});

test('PR projection accepts explicit roots when archived nodes have no change markers', () => {
  const nodes = [node('changed'), node('impact'), node('unrelated')];
  const projection = projectPRGraph(nodes, [edge('changed', 'impact')], { rootNodeIds: ['changed'], upstreamDepth: 1, downstreamDepth: 1 });
  assert.deepEqual(ids(projection), ['changed', 'impact']);
});

test('traverses a shared neighbor independently in both directions', () => {
  const nodes = [node('root'), node('shared'), node('downstream')];
  const projection = projectGraph(nodes, [edge('shared', 'root'), edge('root', 'shared'), edge('shared', 'downstream')], { activeNodeId: 'root', upstreamDepth: 1, downstreamDepth: 2 });
  assert.deepEqual(ids(projection), ['root', 'shared', 'downstream']);
});
