import type { InvestigationState } from './types';

export interface InvestigationHistory {
  back: InvestigationState[];
  current: InvestigationState;
  forward: InvestigationState[];
}

function snapshot(state: InvestigationState): InvestigationState {
  return { ...state, selectedEntity: null };
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
