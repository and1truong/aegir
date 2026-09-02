import assert from 'node:assert/strict';
import test from 'node:test';
import { investigationReducer } from '../investigation/reducer.ts';
import { createInvestigationState } from '../investigation/types.ts';
import { LocalStorageSavedViewRepository, type SavedViewStorage } from './repository.ts';
import { hydrateSavedView } from './schema.ts';

class MemoryStorage implements SavedViewStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function exampleState(name: string) {
  let state = createInvestigationState({ contextKey: 'snapshot:repo:7', projectionId: name });
  state = investigationReducer(state, { type: 'setFocalNode', nodeId: `node:${name}` });
  state = investigationReducer(state, { type: 'pinNode', nodeId: 'reference' });
  state = investigationReducer(state, { type: 'setDepth', direction: 'downstream', depth: 3 });
  return state;
}

test('four semantic views round-trip exactly on the same snapshot', () => {
  const storage = new MemoryStorage();
  const repository = new LocalStorageSavedViewRepository(storage, () => '2026-01-01T00:00:00Z');
  const states = ['critical-path', 'risk-review', 'runtime', 'ownership'].map(exampleState);
  states.forEach((state, index) => repository.save(`View ${index + 1}`, state));
  assert.equal(repository.list().length, 4);
  repository.list().forEach((view, index) => assert.deepEqual(JSON.parse(JSON.stringify(view.state)), JSON.parse(JSON.stringify(states[index]))));
});

test('migrates legacy records and ignores invalid records', () => {
  const storage = new MemoryStorage();
  storage.setItem('aegir:saved-views:v1', JSON.stringify([{ name: 'Legacy', state: exampleState('dependencies') }, { nope: true }]));
  const views = new LocalStorageSavedViewRepository(storage).list();
  assert.equal(views.length, 1);
  assert.equal(views[0].version, 1);
  assert.match(views[0].id, /^view:legacy:/);
});

test('duplicate names update within one context without duplicating', () => {
  const repository = new LocalStorageSavedViewRepository(new MemoryStorage(), () => 'now');
  repository.save('Risk', exampleState('dependencies'));
  const changed = exampleState('runtime');
  repository.save('risk', changed);
  assert.equal(repository.list().length, 1);
  assert.equal(repository.list()[0].state.projectionId, 'runtime');
});

test('hydrate reports stale context, missing identities, and PR path gaps', () => {
  const repository = new LocalStorageSavedViewRepository(new MemoryStorage(), () => 'now');
  const state = exampleState('review');
  state.contextKey = 'review:repo:base:head';
  state.pinnedNodeIds = ['reference', 'missing-pin'];
  state.lockedPath = { id: 'path', version: 1, queryId: 'failure-propagation', nodeIds: [state.focalNodeId!, 'missing-node'], edgeIds: ['missing-edge'], evidencePolicy: { maximumLevel: 'observed', includeStale: false }, sourceNodeId: state.focalNodeId!, targetNodeId: 'missing-node', semanticHops: 1, alternateCount: 0, abstraction: 'symbol' };
  const view = repository.save('PR path', state);
  const restored = hydrateSavedView(view, 'review:repo:new-base:new-head', new Set([state.focalNodeId!, 'reference']), new Set());
  assert.deepEqual(restored.warnings.map((warning) => warning.code), ['stale-context', 'missing-pin', 'broken-path']);
  assert.deepEqual(restored.state.pinnedNodeIds, ['reference']);
  assert.equal(restored.state.contextKey, 'review:repo:new-base:new-head');
});

test('storage failures are surfaced on writes and tolerated on reads', () => {
  const failing: SavedViewStorage = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } };
  const repository = new LocalStorageSavedViewRepository(failing);
  assert.deepEqual(repository.list(), []);
  assert.throws(() => repository.save('View', exampleState('dependencies')), /blocked/);
});
