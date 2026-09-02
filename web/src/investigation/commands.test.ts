import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvidenceRecord, SysEdge, SysNode } from '../data/types.ts';
import { createGraphIndex } from '../graph/index.ts';
import { projectionDefinitions } from '../graph/projection/definitions.ts';
import { LocalStorageSavedViewRepository, type SavedViewStorage } from '../savedViews/repository.ts';
import { createHistory, goBack, recordInvestigationAction } from './history.ts';
import { CommandValidationError, executeCommands, planAgentPhrase, previewCommands, type CommandContext, type InvestigationCommandBatch } from './commands.ts';
import { createInvestigationState, type LockedPath } from './types.ts';

const nodes: SysNode[] = [{ id: 'a', kind: 'function', label: 'A' }, { id: 'b', kind: 'function', label: 'B' }, { id: 'c', kind: 'function', label: 'C', pr: 'added' }];
const edges: SysEdge[] = [{ id: 'a-b', source: 'a', target: 'b', kind: 'calls' }, { id: 'b-c', source: 'b', target: 'c', kind: 'calls' }];
const evidence: EvidenceRecord[] = edges.map((edge) => ({ id: `e:${edge.id}`, source: 'CODE', strength: 'proven', subject: { kind: 'edge', id: edge.id }, summary: edge.id }));
const graphIndex = createGraphIndex(nodes, edges, evidence);
const context: CommandContext = { nodeIds: new Set(nodes.map((node) => node.id)), edgeIds: new Set(edges.map((edge) => edge.id)), frontierIds: new Set(['frontier:a']), projectionIds: new Set(Object.keys(projectionDefinitions)), graphIndex };
const initial = createInvestigationState({ contextKey: 'snapshot:1' });

function batch(commands: InvestigationCommandBatch['commands']): InvestigationCommandBatch {
  return { id: 'test', expectedContextKey: initial.contextKey, provenance: { kind: 'agent', label: 'test' }, commands };
}

const path: LockedPath = { id: 'path:a-b', version: 1, queryId: 'semantic-dependency', nodeIds: ['a', 'b'], edgeIds: ['a-b'], evidencePolicy: { maximumLevel: 'observed', includeStale: false }, sourceNodeId: 'a', targetNodeId: 'b', semanticHops: 1, alternateCount: 0, abstraction: 'symbol' };

test('all graph command DTOs execute through deterministic state transitions', () => {
  const commands: InvestigationCommandBatch['commands'] = [
    { type: 'setProjection', projectionId: 'runtime' },
    { type: 'setFocalNode', nodeId: 'a' },
    { type: 'setDepth', direction: 'downstream', depth: 3 },
    { type: 'setEvidencePolicy', maximumLevel: 'proven', includeStale: false },
    { type: 'setRelationshipOverride', kind: 'depends_on', value: 'include' },
    { type: 'expandFrontier', frontierId: 'frontier:a' },
    { type: 'setAbstraction', abstraction: 'package' },
    { type: 'runPathQuery', definitionId: 'semantic-dependency', sourceNodeId: 'a', targetNodeId: 'b' },
    { type: 'lockPath', path },
    { type: 'setPins', nodeIds: ['c'] },
  ];
  const result = executeCommands(initial, batch(commands), context);
  assert.equal(result.state.projectionId, 'runtime');
  assert.equal(result.state.focalNodeId, 'a');
  assert.equal(result.state.depth.downstream, 3);
  assert.equal(result.state.lockedPath?.id, path.id);
  assert.deepEqual(result.state.pinnedNodeIds, ['c']);
  assert.deepEqual(result.paths[0].edgeIds, ['a-b']);
});

test('saved views apply as explicit commands', () => {
  const values = new Map<string, string>();
  const storage: SavedViewStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) } };
  const repository = new LocalStorageSavedViewRepository(storage, () => 'now');
  const savedState = { ...initial, projectionId: 'coverage' };
  const view = repository.save('Coverage', savedState);
  const result = executeCommands(initial, batch([{ type: 'applySavedView', viewId: view.id }]), { ...context, savedViews: new Map([[view.id, view]]) });
  assert.equal(result.state.projectionId, 'coverage');
});

test('preview and apply are equal and application is undoable', () => {
  const proposal = planAgentPhrase('Show only risky paths introduced by this PR.', initial.contextKey, ['c']);
  const preview = previewCommands(initial, proposal, context);
  const applied = executeCommands(initial, proposal, context);
  assert.deepEqual(preview.state, applied.state);
  assert.equal(preview.revision, applied.revision);
  assert.equal(preview.requiresConfirmation, true);
  assert.deepEqual(applied.state.pinnedNodeIds, ['c']);
  let history = createHistory(initial);
  history = recordInvestigationAction(history, { type: 'hydrateView', state: applied.state });
  assert.equal(goBack(history).current.projectionId, 'dependencies');
});

test('validation rejects IDs, permissions, stale paths, and stale contexts', () => {
  assert.throws(() => executeCommands(initial, batch([{ type: 'setFocalNode', nodeId: 'missing' }]), context), CommandValidationError);
  assert.throws(() => executeCommands(initial, batch([{ type: 'setPins', nodeIds: ['a', 'b', 'c', 'd', 'e', 'f'] }]), context), /five pins/);
  assert.throws(() => executeCommands(initial, batch([{ type: 'lockPath', path: { ...path, edgeIds: ['missing'] } }]), context), /stale/);
  assert.throws(() => executeCommands(initial, batch([{ type: 'setProjection', projectionId: 'runtime' }]), { ...context, allowedCommands: new Set(['setDepth']) }), /not permitted/);
  assert.throws(() => executeCommands({ ...initial, contextKey: 'snapshot:2' }, batch([]), context), /Stale command context/);
  assert.throws(() => planAgentPhrase('Do something arbitrary', initial.contextKey), /No deterministic command mapping/);
});
