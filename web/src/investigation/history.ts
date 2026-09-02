import type { InvestigationState } from './types';
import { investigationReducer, type InvestigationAction } from './reducer.ts';

export interface InvestigationHistory {
  back: InvestigationState[];
  current: InvestigationState;
  forward: InvestigationState[];
}

function snapshot(state: InvestigationState): InvestigationState {
  return {
    ...state,
    selectedEntity: null,
    depth: { ...state.depth },
    relationshipOverrides: { ...state.relationshipOverrides },
    evidencePolicy: { ...state.evidencePolicy },
    expandedFrontiers: Object.fromEntries(Object.entries(state.expandedFrontiers).map(([id, expansion]) => [id, { ...expansion }])),
    pinnedNodeIds: [...state.pinnedNodeIds],
    lockedPath: state.lockedPath ? { ...state.lockedPath, nodeIds: [...state.lockedPath.nodeIds], edgeIds: [...state.lockedPath.edgeIds] } : undefined,
    budget: { ...state.budget },
  };
}

export function createHistory(state: InvestigationState): InvestigationHistory {
  return { back: [], current: snapshot(state), forward: [] };
}

export function pushHistory(history: InvestigationHistory, state: InvestigationState, limit = 50): InvestigationHistory {
  return { back: [...history.back, history.current].slice(-limit), current: snapshot(state), forward: [] };
}

export function replaceHistory(history: InvestigationHistory, state: InvestigationState): InvestigationHistory {
  return { ...history, current: snapshot(state) };
}

export function goBack(history: InvestigationHistory): InvestigationHistory {
  const previous = history.back.at(-1);
  if (!previous) return history;
  return { back: history.back.slice(0, -1), current: previous, forward: [history.current, ...history.forward] };
}

export function goForward(history: InvestigationHistory): InvestigationHistory {
  const next = history.forward[0];
  if (!next) return history;
  return { back: [...history.back, history.current], current: next, forward: history.forward.slice(1) };
}

export function recordInvestigationAction(history: InvestigationHistory, action: InvestigationAction): InvestigationHistory {
  const next = investigationReducer(history.current, action);
  if (next === history.current) return history;
  if (action.type === 'resetContext') return createHistory(next);
  if (action.type === 'selectEntity') return { ...history, current: next };
  if (action.type === 'setFocalNode' && next.focalNodeId !== history.current.focalNodeId) return pushHistory(history, next);
  if (action.type === 'setProjection') return pushHistory(history, next);
  if (action.type === 'setAbstraction') return pushHistory(history, next);
  return replaceHistory(history, next);
}

export type HistoryAction =
  | { type: 'investigation'; action: InvestigationAction }
  | { type: 'back' }
  | { type: 'forward' };

export function historyReducer(history: InvestigationHistory, action: HistoryAction): InvestigationHistory {
  if (action.type === 'back') return goBack(history);
  if (action.type === 'forward') return goForward(history);
  return recordInvestigationAction(history, action.action);
}

export function breadcrumbSnapshots(history: InvestigationHistory) {
  const result: InvestigationState[] = [];
  for (const state of [...history.back, history.current]) {
    if (!state.focalNodeId || state.contextKey !== history.current.contextKey) continue;
    if (result.at(-1)?.focalNodeId === state.focalNodeId) result[result.length - 1] = state;
    else result.push(state);
  }
  return result;
}

export function serializeHistory(history: InvestigationHistory) {
  return JSON.stringify(history);
}

export function deserializeHistory(value: string, fallback: InvestigationState): InvestigationHistory {
  try {
    const parsed = JSON.parse(value) as InvestigationHistory;
    if (!parsed.current || !Array.isArray(parsed.back) || !Array.isArray(parsed.forward)) return createHistory(fallback);
    return { back: parsed.back.slice(-50).map(snapshot), current: snapshot(parsed.current), forward: parsed.forward.slice(0, 50).map(snapshot) };
  } catch {
    return createHistory(fallback);
  }
}

export function reconcileMissingFocal(state: InvestigationState, availableNodeIds: ReadonlySet<string>, fallbackNodeId?: string) {
  if (!state.focalNodeId || availableNodeIds.has(state.focalNodeId)) return state.focalNodeId;
  const lockedHead = state.lockedPath?.nodeIds.find((id) => availableNodeIds.has(id));
  const pin = state.pinnedNodeIds.find((id) => availableNodeIds.has(id));
  return lockedHead ?? pin ?? (fallbackNodeId && availableNodeIds.has(fallbackNodeId) ? fallbackNodeId : undefined);
}
