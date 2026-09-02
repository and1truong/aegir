import assert from 'node:assert/strict';
import test from 'node:test';
import { createHistory, goBack, goForward, pushHistory, replaceHistory } from './history.ts';
import { enabledRelationships, investigationReducer, legacyBranchExpansions } from './reducer.ts';
import { createInvestigationState } from './types.ts';

test('creates the scoped graph defaults', () => {
  const state = createInvestigationState();
  assert.equal(state.projectionId, 'dependencies');
  assert.deepEqual(state.depth, { upstream: 1, downstream: 2 });
  assert.deepEqual(state.budget, { target: 30, hard: 40, allowLargeGraph: false });
});

test('context reset clears semantic state without carrying another repository', () => {
  let state = createInvestigationState({ contextKey: 'snapshot:a' });
  state = investigationReducer(state, { type: 'setFocalNode', nodeId: 'node-a' });
  state = investigationReducer(state, { type: 'expandFrontier', frontierId: 'branch-a' });
  state = investigationReducer(state, { type: 'resetContext', contextKey: 'snapshot:b', projectionId: 'dependencies' });
  assert.equal(state.contextKey, 'snapshot:b');
  assert.equal(state.focalNodeId, undefined);
  assert.deepEqual(state.expandedFrontiers, {});
});

test('projection changes keep the focal node but clear projection refinements', () => {
  let state = createInvestigationState();
  state = investigationReducer(state, { type: 'setFocalNode', nodeId: 'root' });
  state = investigationReducer(state, { type: 'setRelationshipOverride', kind: 'calls', value: 'exclude' });
  state = investigationReducer(state, { type: 'expandFrontier', frontierId: 'branch' });
  state = investigationReducer(state, { type: 'setProjection', projectionId: 'data flow' });
  assert.equal(state.focalNodeId, 'root');
  assert.equal(state.projectionId, 'data flow');
  assert.deepEqual(state.relationshipOverrides, {});
  assert.deepEqual(state.expandedFrontiers, {});
});

test('relationship overrides derive an enabled set from projection defaults', () => {
  let state = createInvestigationState();
  state = investigationReducer(state, { type: 'setRelationshipOverride', kind: 'calls', value: 'exclude' });
  state = investigationReducer(state, { type: 'setRelationshipOverride', kind: 'reads', value: 'include' });
  assert.deepEqual([...enabledRelationships(state, ['calls', 'depends_on'])].sort(), ['depends_on', 'reads']);
});

test('frontier expansion remains compatible with the current projector', () => {
  let state = createInvestigationState();
  state = investigationReducer(state, { type: 'expandFrontier', frontierId: 'branch', beyondDepth: true });
  state = investigationReducer(state, { type: 'expandFrontier', frontierId: 'branch' });
  assert.deepEqual(legacyBranchExpansions(state), { branch: 2 });
  state = investigationReducer(state, { type: 'collapseFrontier', frontierId: 'branch' });
  assert.deepEqual(legacyBranchExpansions(state), {});
});

test('history pushes navigation, replaces refinements, and supports back and forward', () => {
  const first = createInvestigationState({ contextKey: 'snapshot:a' });
  const second = investigationReducer(first, { type: 'setFocalNode', nodeId: 'second' });
  const refined = investigationReducer(second, { type: 'setDepth', direction: 'downstream', depth: 3 });
  let history = createHistory(first);
  history = pushHistory(history, second);
  history = replaceHistory(history, refined);
  history = goBack(history);
  assert.equal(history.current.focalNodeId, undefined);
  history = goForward(history);
  assert.equal(history.current.focalNodeId, 'second');
  assert.equal(history.current.depth.downstream, 3);
  assert.equal(history.current.selectedEntity, null);
});
