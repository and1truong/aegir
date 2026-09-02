import type { EdgeKind } from '../data/types.ts';
import type { GraphIndex, ProjectionDepth } from '../graph/types.ts';
import { pathQueryDefinitions, runPathQuery, type PathQueryId, type SemanticPath } from '../path/query.ts';
import { hydrateSavedView, type SavedView } from '../savedViews/schema.ts';
import { investigationReducer } from './reducer.ts';
import type { AbstractionLevel, EvidenceLevel, InvestigationState, LockedPath, RelationshipOverride } from './types.ts';

export type CommandProvenance = { kind: 'user' | 'agent' | 'saved-view'; label: string };

export type InvestigationCommand =
  | { type: 'setProjection'; projectionId: string }
  | { type: 'setFocalNode'; nodeId: string }
  | { type: 'setDepth'; direction: 'upstream' | 'downstream'; depth: ProjectionDepth }
  | { type: 'setEvidencePolicy'; maximumLevel: EvidenceLevel; includeStale: boolean }
  | { type: 'setRelationshipOverride'; kind: EdgeKind; value: RelationshipOverride }
  | { type: 'expandFrontier'; frontierId: string; beyondDepth?: boolean }
  | { type: 'setAbstraction'; abstraction: AbstractionLevel }
  | { type: 'runPathQuery'; definitionId: PathQueryId; sourceNodeId: string; targetNodeId: string }
  | { type: 'lockPath'; path: LockedPath }
  | { type: 'setPins'; nodeIds: string[] }
  | { type: 'applySavedView'; viewId: string };

export interface InvestigationCommandBatch {
  id: string;
  expectedContextKey: string;
  provenance: CommandProvenance;
  commands: InvestigationCommand[];
}

export interface CommandContext {
  nodeIds: ReadonlySet<string>;
  edgeIds: ReadonlySet<string>;
  frontierIds?: ReadonlySet<string>;
  projectionIds: ReadonlySet<string>;
  allowedCommands?: ReadonlySet<InvestigationCommand['type']>;
  savedViews?: ReadonlyMap<string, SavedView>;
  graphIndex?: GraphIndex;
}

export interface CommandExecution {
  state: InvestigationState;
  revision: string;
  changes: Array<{ field: string; before: unknown; after: unknown }>;
  paths: SemanticPath[];
}

export interface CommandPreview extends CommandExecution {
  batch: InvestigationCommandBatch;
  requiresConfirmation: boolean;
}

export class CommandValidationError extends Error {}

function assertAllowed(command: InvestigationCommand, context: CommandContext) {
  if (context.allowedCommands && !context.allowedCommands.has(command.type)) throw new CommandValidationError(`Command ${command.type} is not permitted.`);
}

function validateCommand(command: InvestigationCommand, context: CommandContext) {
  assertAllowed(command, context);
  if (command.type === 'setProjection' && !context.projectionIds.has(command.projectionId)) throw new CommandValidationError(`Unknown projection: ${command.projectionId}`);
  if (command.type === 'setFocalNode' && !context.nodeIds.has(command.nodeId)) throw new CommandValidationError(`Unknown node: ${command.nodeId}`);
  if (command.type === 'setPins') {
    if (command.nodeIds.length > 5) throw new CommandValidationError('At most five pins are allowed.');
    const missing = command.nodeIds.find((id) => !context.nodeIds.has(id));
    if (missing) throw new CommandValidationError(`Unknown pin node: ${missing}`);
  }
  if (command.type === 'expandFrontier' && context.frontierIds && !context.frontierIds.has(command.frontierId)) throw new CommandValidationError(`Unknown frontier: ${command.frontierId}`);
  if (command.type === 'runPathQuery') {
    if (!pathQueryDefinitions[command.definitionId]) throw new CommandValidationError(`Unknown path query: ${command.definitionId}`);
    if (!context.nodeIds.has(command.sourceNodeId) || !context.nodeIds.has(command.targetNodeId)) throw new CommandValidationError('Path endpoints are not present in this context.');
    if (!context.graphIndex) throw new CommandValidationError('Path commands require a graph index.');
  }
  if (command.type === 'lockPath') {
    const missingNode = command.path.nodeIds.find((id) => !context.nodeIds.has(id));
    const missingEdge = command.path.edgeIds.find((id) => !context.edgeIds.has(id));
    if (missingNode || missingEdge) throw new CommandValidationError(`Locked path is stale: ${missingNode ?? missingEdge}`);
  }
  if (command.type === 'applySavedView' && !context.savedViews?.has(command.viewId)) throw new CommandValidationError(`Unknown saved view: ${command.viewId}`);
}

function revision(state: InvestigationState) {
  return JSON.stringify({ contextKey: state.contextKey, projectionId: state.projectionId, focalNodeId: state.focalNodeId, depth: state.depth, relationshipOverrides: state.relationshipOverrides, evidencePolicy: state.evidencePolicy, abstraction: state.abstraction, expandedFrontiers: state.expandedFrontiers, pinnedNodeIds: state.pinnedNodeIds, lockedPath: state.lockedPath });
}

function changes(before: InvestigationState, after: InvestigationState) {
  return (Object.keys(after) as Array<keyof InvestigationState>).flatMap((field) => JSON.stringify(before[field]) === JSON.stringify(after[field]) ? [] : [{ field, before: before[field], after: after[field] }]);
}

export function executeCommands(initial: InvestigationState, batch: InvestigationCommandBatch, context: CommandContext): CommandExecution {
  if (initial.contextKey !== batch.expectedContextKey) throw new CommandValidationError(`Stale command context: expected ${batch.expectedContextKey}, received ${initial.contextKey}.`);
  let state = initial;
  const paths: SemanticPath[] = [];
  for (const command of batch.commands) {
    validateCommand(command, context);
    switch (command.type) {
      case 'setProjection': state = investigationReducer(state, { type: 'setProjection', projectionId: command.projectionId }); break;
      case 'setFocalNode': state = investigationReducer(state, { type: 'setFocalNode', nodeId: command.nodeId }); break;
      case 'setDepth': state = investigationReducer(state, { type: 'setDepth', direction: command.direction, depth: command.depth }); break;
      case 'setEvidencePolicy': state = investigationReducer(state, { type: 'setEvidencePolicy', maximumLevel: command.maximumLevel, includeStale: command.includeStale }); break;
      case 'setRelationshipOverride': state = investigationReducer(state, { type: 'setRelationshipOverride', kind: command.kind, value: command.value }); break;
      case 'expandFrontier': state = investigationReducer(state, { type: 'expandFrontier', frontierId: command.frontierId, beyondDepth: command.beyondDepth }); break;
      case 'setAbstraction': state = investigationReducer(state, { type: 'setAbstraction', abstraction: command.abstraction }); break;
      case 'runPathQuery': {
        const result = runPathQuery(context.graphIndex!, { definitionId: command.definitionId, sourceNodeId: command.sourceNodeId, targetNodeId: command.targetNodeId, evidencePolicy: state.evidencePolicy, maxAlternatives: 2 });
        if (!result.path) throw new CommandValidationError(result.noPath?.message ?? 'No path found.');
        paths.push(result.path);
        break;
      }
      case 'lockPath': state = investigationReducer(state, { type: 'lockPath', path: command.path }); break;
      case 'setPins': state = { ...state, pinnedNodeIds: [...new Set(command.nodeIds)] }; break;
      case 'applySavedView': state = hydrateSavedView(context.savedViews!.get(command.viewId)!, state.contextKey, context.nodeIds, context.edgeIds).state; break;
    }
  }
  return { state, revision: revision(state), changes: changes(initial, state), paths };
}

export function previewCommands(initial: InvestigationState, batch: InvestigationCommandBatch, context: CommandContext): CommandPreview {
  return { ...executeCommands(initial, batch, context), batch, requiresConfirmation: batch.commands.length > 1 || batch.commands.some((command) => command.type === 'lockPath' || command.type === 'applySavedView') };
}

export function planAgentPhrase(phrase: string, contextKey: string, changedNodeIds: readonly string[] = []): InvestigationCommandBatch {
  const normalized = phrase.trim().toLocaleLowerCase().replace(/[.?!]+$/, '');
  if (normalized !== 'show only risky paths introduced by this pr') throw new CommandValidationError('No deterministic command mapping exists for this phrase.');
  return {
    id: 'agent:risky-pr-paths:v1',
    expectedContextKey: contextKey,
    provenance: { kind: 'agent', label: phrase },
    commands: [
      { type: 'setProjection', projectionId: 'what-changed-architecturally' },
      { type: 'setEvidencePolicy', maximumLevel: 'observed', includeStale: false },
      { type: 'setDepth', direction: 'upstream', depth: 1 },
      { type: 'setDepth', direction: 'downstream', depth: 2 },
      { type: 'setPins', nodeIds: [...new Set(changedNodeIds)].sort().slice(0, 3) },
    ],
  };
}
