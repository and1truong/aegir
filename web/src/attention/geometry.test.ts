import assert from 'node:assert/strict';
import test from 'node:test';
import { bubblePaintOrder, bubbleRadius, jitteredScore, stableJitter, zoomedScore } from './geometry.ts';
import type { AttentionUnit } from './types.ts';

function unit(velocity?: number, id = 'package:a'): AttentionUnit {
  return { unit: { id, label: id, kind: 'package' }, impact: { score: 50, coverage: 1, factors: [] }, changeComplexity: { score: 50, coverage: 1, factors: [] }, changeVelocity: { score: velocity ?? null, coverage: velocity === undefined ? 0 : 1, factors: [] }, priority: 50, region: 'low-attention', memberCount: 1 };
}

test('bubble area grows with velocity while missing history stays visibly bounded', () => {
  assert.equal(bubbleRadius(unit()), 6);
  assert.equal(bubbleRadius({ ...unit(50), changeVelocity: { score: null, coverage: 0, factors: [] } }), 6);
  assert.ok(bubbleRadius(unit(100)) > bubbleRadius(unit(0)));
});

test('zoom is deterministic and keeps every score in the visible domain', () => {
  assert.equal(zoomedScore(50, 3), .5);
  assert.equal(zoomedScore(60, 2), .7);
  assert.equal(zoomedScore(0, 3), 0);
  assert.equal(zoomedScore(100, 3), 1);
  assert.deepEqual(stableJitter('package:a'), stableJitter('package:a'));
});

test('jitter stays on the classified side of policy thresholds', () => {
  assert.equal(jitteredScore(60, 60, 1, -.1), .6);
  assert.ok(jitteredScore(59, 60, 1, .1) < .6);
});

test('paint order draws smaller bubbles last for topmost hit testing', () => {
  const points = [{ unit: unit(0, 'small') }, { unit: unit(100, 'large') }];
  assert.deepEqual(bubblePaintOrder(points).map((point) => point.unit.unit.id), ['large', 'small']);
});
