import assert from 'node:assert/strict';
import test from 'node:test';
import type { GraphDelta, SysEdge, SysNode } from '../data/types';
import { dependencyIntroduction, evidenceValidity, profileSnapshotStorage, reconstructGraph, resolveSnapshotPair, type Timeline } from './timeline.ts';

const a: SysNode = { id: 'a', kind: 'service', label: 'A' };
const b: SysNode = { id: 'b', kind: 'service', label: 'B' };
const c: SysNode = { id: 'c', kind: 'service', label: 'C' };
const ab: SysEdge = { id: 'ab', source: 'a', target: 'b', kind: 'calls' };
const bc: SysEdge = { id: 'bc', source: 'b', target: 'c', kind: 'calls' };
const delta = (nodes: GraphDelta['nodes'], edges: GraphDelta['edges']): GraphDelta => ({ nodes, edges });

const timeline: Timeline = {
  version: 1,
  snapshots: [
    { version: 1, repositoryId: 'repo', snapshotId: 1, commit: 'base', createdAt: '2026-01-01T00:00:00Z', kind: 'review', fingerprint: 'a', storageBytes: 100 },
    { version: 1, repositoryId: 'repo', snapshotId: 2, commit: 'head', createdAt: '2026-01-02T00:00:00Z', kind: 'review', fingerprint: 'b', storageBytes: 120 },
  ],
  reviews: [{ id: 'review', createdAt: '2026-01-02T00:00:00Z', baseRef: 'base', headRef: 'head', baseSnapshotId: 1, headSnapshotId: 2, delta: delta([{ id: 'c', status: 'added', after: c, changeReasons: [] }], [{ id: 'bc', status: 'added', after: bc, changeReasons: [] }]) }],
};

test('reconstructs deterministic typed delta chains', () => {
  const modifiedB = { ...b, label: 'B2' };
  const result = reconstructGraph({ nodes: [b, a], edges: [ab] }, [
    delta([{ id: 'b', status: 'modified', before: b, after: modifiedB, changeReasons: [] }, { id: 'c', status: 'added', after: c, changeReasons: [] }], [{ id: 'bc', status: 'added', after: bc, changeReasons: [] }]),
    delta([{ id: 'a', status: 'removed', before: a, changeReasons: [] }], [{ id: 'ab', status: 'removed', before: ab, changeReasons: [] }]),
  ]);
  assert.deepEqual(result.nodes, [modifiedB, c]);
  assert.deepEqual(result.edges, [bc]);
});

test('reports missing temporal snapshots explicitly', () => {
  const pair = resolveSnapshotPair(timeline, 'review');
  assert.ok('base' in pair);
  assert.equal(pair.base?.snapshotId, 1);
  const missingSnapshot = resolveSnapshotPair({ ...timeline, snapshots: timeline.snapshots.slice(1) }, 'review');
  assert.ok('error' in missingSnapshot);
  assert.match(missingSnapshot.error ?? '', /Snapshot 1/);
  const missingReview = resolveSnapshotPair(timeline, 'missing');
  assert.ok('error' in missingReview);
  assert.match(missingReview.error ?? '', /Review is missing/);
});

test('evaluates evidence validity at a selected snapshot', () => {
  const head = timeline.snapshots[1];
  assert.equal(evidenceValidity({ id: 'e1', source: 'CODE', strength: 'proven', subject: { kind: 'edge', id: 'bc' }, summary: '', snapshotId: 2 }, head), 'valid');
  assert.equal(evidenceValidity({ id: 'e2', source: 'RUNTIME', strength: 'observed', subject: { kind: 'edge', id: 'bc' }, summary: '', snapshotId: 1 }, head), 'stale');
  assert.equal(evidenceValidity({ id: 'e3', source: 'GIT', strength: 'proven', subject: { kind: 'edge', id: 'bc' }, summary: '', snapshotId: 3 }, head), 'future');
  assert.equal(evidenceValidity({ id: 'e4', source: 'STATIC', strength: 'proven', subject: { kind: 'edge', id: 'bc' }, summary: '' }, head), 'unscoped');
});

test('answers dependency introduction deterministically and profiles retention', () => {
  const introduced = dependencyIntroduction('bc', timeline);
  assert.equal(introduced?.review.id, 'review');
  assert.equal(introduced?.snapshot?.commit, 'head');
  assert.equal(dependencyIntroduction('missing', timeline), undefined);
  assert.deepEqual(profileSnapshotStorage(timeline.snapshots), { count: 2, totalBytes: 220, averageBytes: 110, recommendation: 'full-snapshots' });
  assert.equal(profileSnapshotStorage(Array.from({ length: 21 }, (_, index) => ({ ...timeline.snapshots[0], snapshotId: index }))).recommendation, 'checkpoint-deltas');
});
