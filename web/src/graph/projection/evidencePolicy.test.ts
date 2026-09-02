import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvidenceRecord, SysEdge, SysNode } from '../../data/types.ts';
import { createGraphIndex } from '../index.ts';
import { projectionDefinition } from './definitions.ts';
import { eligibleEvidenceIds, evidenceSatisfies } from './evidencePolicy.ts';
import { projectVisibleGraph } from './engine.ts';

const nodes: SysNode[] = [{ id: 'a', kind: 'function', label: 'A' }, { id: 'b', kind: 'function', label: 'B' }, { id: 'c', kind: 'function', label: 'C' }];
const edges: SysEdge[] = [{ id: 'a|calls|b', source: 'a', target: 'b', kind: 'calls' }, { id: 'b|calls|c', source: 'b', target: 'c', kind: 'calls' }];
const evidence: EvidenceRecord[] = [
  { id: 'proven', source: 'CODE', strength: 'proven', subject: { kind: 'edge', id: edges[0].id }, summary: 'call site' },
  { id: 'observed-stale', source: 'RUNTIME', strength: 'observed', subject: { kind: 'edge', id: edges[1].id }, summary: 'trace', validUntil: '2024-01-01T00:00:00Z' },
];

test('evidence levels and stale policy are deterministic', () => {
  assert.equal(evidenceSatisfies(evidence[0], { maximumLevel: 'proven', includeStale: false }, 0), true);
  assert.equal(evidenceSatisfies(evidence[1], { maximumLevel: 'observed', includeStale: false }, Date.parse('2025-01-01T00:00:00Z')), false);
  assert.equal(evidenceSatisfies(evidence[1], { maximumLevel: 'observed', includeStale: true }, Date.parse('2025-01-01T00:00:00Z')), true);
});

test('strict evidence filtering breaks traversal and exposes surviving evidence only', () => {
  const index = createGraphIndex(nodes, edges, evidence);
  assert.deepEqual(eligibleEvidenceIds(index, edges[0], { maximumLevel: 'proven', includeStale: false }), ['proven']);
  const graph = projectVisibleGraph(index, projectionDefinition('dependencies'), { activeNodeId: 'a', downstreamDepth: 3, upstreamDepth: 0, evidencePolicy: { maximumLevel: 'proven', includeStale: false } });
  assert.deepEqual(graph.nodes.filter((node) => node.kind === 'real').map((node) => node.id), ['a', 'b']);
  assert.deepEqual(graph.edges.filter((edge) => edge.kind === 'real').map((edge) => edge.evidenceIds), [['proven']]);
});
