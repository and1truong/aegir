import assert from 'node:assert/strict';
import test from 'node:test';
import { clearLayoutCache, layoutComputationCount, positionGraph } from './dagreLayout.ts';
import { clampSlot, screenPoint, viewportForAnchor } from './viewport.ts';

const nodes = [{ id: 'root', width: 100, height: 40 }, { id: 'a', width: 100, height: 40 }, { id: 'b', width: 100, height: 40 }];
const links = [{ source: 'root', target: 'a' }, { source: 'root', target: 'b' }];

test('fresh deterministic layout normalizes the focal center to model origin', () => {
  clearLayoutCache();
  const first = positionGraph('one', nodes, links, 'dependency-LR', 'root');
  const second = positionGraph('two', nodes, links, 'dependency-LR', 'root');
  assert.deepEqual(first.positions, second.positions);
  const root = first.positions.get('root')!;
  assert.deepEqual({ x: root.x + 50, y: root.y + 20 }, { x: 0, y: 0 });
  assert.equal(first.anchor?.nodeId, 'root');
});

test('decoration reuse does not recompute topology layout', () => {
  clearLayoutCache();
  const first = positionGraph('stable', nodes, links, 'dependency-LR', 'root');
  const second = positionGraph('stable', nodes, links, 'dependency-LR', 'root');
  assert.equal(first, second);
  assert.equal(layoutComputationCount(), 1);
});

test('viewport transform maps the model anchor to a stable clamped slot', () => {
  const slot = clampSlot({ x: 950, y: 20 }, 1000, 600);
  assert.deepEqual(slot, { x: 800, y: 120 });
  const viewport = viewportForAnchor({ x: 0, y: 0 }, slot, 0.8);
  assert.deepEqual(screenPoint({ x: 0, y: 0 }, viewport), slot);
});

test('missing anchor leaves deterministic positions available for fit fallback', () => {
  clearLayoutCache();
  const positioned = positionGraph('missing-anchor', nodes, links, 'dependency-LR', 'deleted');
  assert.equal(positioned.anchor, null);
  assert.equal(positioned.positions.size, nodes.length);
});

test('pin soft constraints use stable semantic lane order', () => {
  clearLayoutCache();
  const positioned = positionGraph('pins', nodes, links, 'dependency-LR', 'root', ['b', 'a']);
  assert.ok(positioned.positions.get('a')!.y <= positioned.positions.get('b')!.y);
  assert.equal(layoutComputationCount(), 1);
});

test('locked paths keep ordered nodes on one stable lane', () => {
  clearLayoutCache();
  const pathNodes = ['a', 'b', 'c', 'noise'].map((id) => ({ id, width: 100, height: 40 }));
  const result = positionGraph('locked-path', pathNodes, [{ source: 'c', target: 'b' }, { source: 'b', target: 'a' }, { source: 'noise', target: 'b' }], 'dependency-LR', 'b', [], ['a', 'b', 'c']);
  const path = ['a', 'b', 'c'].map((id) => result.positions.get(id)!);
  assert.ok(path[0].x < path[1].x && path[1].x < path[2].x);
  assert.deepEqual(path.map((point) => point.y), [path[0].y, path[0].y, path[0].y]);
});
