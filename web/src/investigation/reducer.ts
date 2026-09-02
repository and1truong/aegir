import type { EdgeKind } from '../data/types';
import type { ProjectionDepth } from '../lib/graphProjection';
import { createInvestigationState, type InvestigationState, type ProjectionId, type RelationshipOverride } from './types.ts';

export type InvestigationAction =
  | { type: 'resetContext'; contextKey: string; projectionId?: ProjectionId }
  | { type: 'setFocalNode'; nodeId?: string }
  | { type: 'reconcileFocalNode'; nodeId?: string }
  | { type: 'selectEntity'; entity: InvestigationState['selectedEntity'] }
  | { type: 'setProjection'; projectionId: ProjectionId }
  | { type: 'setDepth'; direction: 'upstream' | 'downstream'; depth: ProjectionDepth }
  | { type: 'setRelationshipOverride'; kind: EdgeKind; value: RelationshipOverride }
  | { type: 'clearRelationshipOverrides' }
  | { type: 'expandFrontier'; frontierId: string; beyondDepth?: boolean }
  | { type: 'collapseFrontier'; frontierId: string }
  | { type: 'clearFrontiers' };

export function investigationReducer(state: InvestigationState, action: InvestigationAction): InvestigationState {
  switch (action.type) {
    case 'resetContext':
      if (state.contextKey === action.contextKey && (!action.projectionId || state.projectionId === action.projectionId)) return state;
      return createInvestigationState({ contextKey: action.contextKey, projectionId: action.projectionId ?? state.projectionId });
    case 'setFocalNode':
    case 'reconcileFocalNode':
      return {
        ...state,
        focalNodeId: action.nodeId,
        selectedEntity: action.nodeId ? { kind: 'node', id: action.nodeId } : null,
        expandedFrontiers: {},
      };
    case 'selectEntity':
      return { ...state, selectedEntity: action.entity };
    case 'setProjection':
      if (state.projectionId === action.projectionId) return state;
      return { ...state, projectionId: action.projectionId, relationshipOverrides: {}, expandedFrontiers: {}, selectedEntity: state.focalNodeId ? { kind: 'node', id: state.focalNodeId } : null };
    case 'setDepth':
      return { ...state, depth: { ...state.depth, [action.direction]: action.depth } };
    case 'setRelationshipOverride': {
      const next = { ...state.relationshipOverrides };
      if (action.value === 'default') delete next[action.kind];
      else next[action.kind] = action.value;
      return { ...state, relationshipOverrides: next, expandedFrontiers: {} };
    }
    case 'clearRelationshipOverrides':
      return { ...state, relationshipOverrides: {}, expandedFrontiers: {} };
    case 'expandFrontier': {
      const current = state.expandedFrontiers[action.frontierId];
      return {
        ...state,
        expandedFrontiers: {
          ...state.expandedFrontiers,
          [action.frontierId]: { pages: (current?.pages ?? 0) + 1, beyondDepth: action.beyondDepth ?? current?.beyondDepth },
        },
        selectedEntity: { kind: 'frontier', id: action.frontierId },
      };
    }
    case 'collapseFrontier': {
      const next = { ...state.expandedFrontiers };
      delete next[action.frontierId];
      return { ...state, expandedFrontiers: next, selectedEntity: state.focalNodeId ? { kind: 'node', id: state.focalNodeId } : null };
    }
    case 'clearFrontiers':
      return { ...state, expandedFrontiers: {} };
  }
}

export function enabledRelationships(state: InvestigationState, defaults: readonly EdgeKind[]) {
  const result = new Set(defaults);
  for (const [kind, value] of Object.entries(state.relationshipOverrides) as [EdgeKind, RelationshipOverride][]) {
    if (value === 'include') result.add(kind);
    if (value === 'exclude') result.delete(kind);
  }
  return result;
}

export function legacyBranchExpansions(state: InvestigationState) {
  return Object.fromEntries(Object.entries(state.expandedFrontiers).map(([id, expansion]) => [id, expansion.pages]));
}
