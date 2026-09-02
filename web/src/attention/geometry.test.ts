import assert from 'node:assert/strict';
import test from 'node:test';
import { bubbleRadius, stableJitter, zoomedScore } from './geometry.ts';
import type { AttentionUnit } from './types.ts';

function unit(velocity?: number): AttentionUnit {
  return { unit: { id: 'package:a', label: 'a', kind: 'package' }, impact: { score: 50, coverage: 1, factors: [] }, changeComplexity: { score: 50, coverage: 1, factors: [] }, changeVelocity: { score: velocity ?? null, coverage: velocity === undefined ? 0 : 1, factors: [] }, priority: 50, region: 'low-attention', memberCount: 1 };
}

test('bubble area grows with velocity while missing history stays visibly bounded', () => {
  assert.equal(bubbleRadius(unit()), 6);
  assert.equal(bubbleRadius({ ...unit(50), changeVelocity: { score: null, coverage: 0, factors: [] } }), 6);
  assert.ok(bubbleRadius(unit(100)) > bubbleRadius(unit(0)));
});

test('zoom is deterministic and keeps every score in the visible domain', () => {
  assert.equal(zoomedScore(50, 3), .5);
  assert.equal(zoomedScore(0, 3), 0);
  assert.equal(zoomedScore(100, 3), 1);
  assert.deepEqual(stableJitter('package:a'), stableJitter('package:a'));
});
