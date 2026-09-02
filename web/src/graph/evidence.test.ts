import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvidenceRecord, SysEdge, SysNode } from '../data/types';
import { createGraphIndex } from './index.ts';
import { evidenceForEdge, formatEvidenceLocation } from './evidence.ts';

test('returns every observation for a collapsed canonical edge', () => {
  const nodes: SysNode[] = [{ id: 'a', kind: 'function', label: 'A' }, { id: 'b', kind: 'function', label: 'B' }];
  const edge: SysEdge = { id: 'call', source: 'a', target: 'b', kind: 'calls', evidenceRefs: ['one', 'two'] };
  const records: EvidenceRecord[] = [
    { id: 'one', source: 'CODE', strength: 'proven', subject: { kind: 'edge', id: 'call' }, summary: 'first', location: { file: 'a.go', line: 10 } },
    { id: 'two', source: 'CODE', strength: 'proven', subject: { kind: 'edge', id: 'call' }, summary: 'second', location: { file: 'a.go', line: 20 } },
  ];
  const found = evidenceForEdge(createGraphIndex(nodes, [edge], records), edge);
  assert.deepEqual(found.map((record) => record.id), ['one', 'two']);
  assert.equal(formatEvidenceLocation(found[0]), 'a.go:10');
});

test('provides explicit legacy evidence instead of an empty explanation', () => {
  const nodes: SysNode[] = [{ id: 'a', kind: 'function', label: 'A' }, { id: 'b', kind: 'function', label: 'B' }];
  const edge: SysEdge = { id: 'call', source: 'a', target: 'b', kind: 'calls' };
  const found = evidenceForEdge(createGraphIndex(nodes, [edge]), edge);
  assert.equal(found.length, 1);
  assert.equal(found[0].strength, 'inferred');
});
