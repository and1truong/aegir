import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvidenceRecord, SysEdge, SysNode } from '../data/types.ts';
import { createGraphIndex } from './index.ts';
import { mixedAbstractionGraph } from './mixedAbstraction.ts';

const nodes: SysNode[] = [
  { id: 'checkout', kind: 'service', label: 'checkout-api' },
  { id: 'fraud', kind: 'service', label: 'Fraud API' },
  { id: 'orders-pkg', kind: 'package', label: 'checkout/orders', service: 'checkout' },
  { id: 'web-pkg', kind: 'package', label: 'checkout/web', service: 'checkout' },
  { id: 'create', kind: 'function', label: 'CreateOrder', service: 'checkout', pkg: 'orders-pkg' },
  { id: 'route', kind: 'function', label: 'PostOrders', service: 'checkout', pkg: 'web-pkg' },
];
const edges: SysEdge[] = [
  { id: 'route-create', source: 'route', target: 'create', kind: 'calls' },
  { id: 'create-fraud', source: 'create', target: 'fraud', kind: 'calls', evidenceRefs: ['callsite'] },
];
const evidence: EvidenceRecord[] = [{ id: 'callsite', source: 'CODE', strength: 'proven', subject: { kind: 'edge', id: 'create-fraud' }, summary: 'fraud.Check' }];

test('expands exactly one focal service branch one level below global', () => {
  const mixed = mixedAbstractionGraph(createGraphIndex(nodes, edges, evidence), 'service', 'create');
  assert.deepEqual(mixed.branch, { globalRepresentativeId: 'checkout', globalLevel: 'service', detailLevel: 'component' });
  assert.equal(mixed.canonicalToRepresentative.get('create'), 'orders-pkg');
  assert.equal(mixed.canonicalToRepresentative.get('route'), 'web-pkg');
  assert.equal(mixed.canonicalToRepresentative.get('fraud'), 'fraud');
  assert.equal(mixed.index.nodeById.get('orders-pkg')?.abstractionLevel, 'component');
  assert.equal(mixed.index.nodeById.get('fraud')?.abstractionLevel, 'service');
  const representative = mixed.index.edges.find((edge) => edge.canonicalEdgeIds?.includes('create-fraud'));
  assert.deepEqual(representative?.canonicalEdgeIds, ['create-fraud']);
  assert.equal(mixed.index.evidenceBySubject.get(`edge:${representative?.id}`)?.length, 1);
});

test('package focus reveals symbols without expanding sibling packages', () => {
  const mixed = mixedAbstractionGraph(createGraphIndex(nodes, edges, evidence), 'package', 'create');
  assert.equal(mixed.canonicalToRepresentative.get('create'), 'create');
  assert.equal(mixed.canonicalToRepresentative.get('route'), 'web-pkg');
  assert.equal(mixed.index.nodeById.get('create')?.abstractionLevel, 'symbol');
  assert.equal(mixed.index.nodeById.get('web-pkg')?.abstractionLevel, 'package');
  assert.equal([...mixed.representativeNodeMembers].filter(([, members]) => members.includes('create')).length, 1);
});

test('symbol level and missing focus remain a non-mixed deterministic graph', () => {
  assert.equal(mixedAbstractionGraph(createGraphIndex(nodes, edges, evidence), 'symbol', 'create').branch, undefined);
  assert.equal(mixedAbstractionGraph(createGraphIndex(nodes, edges, evidence), 'service').branch, undefined);
});

