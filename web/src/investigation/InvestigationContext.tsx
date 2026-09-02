import { createContext, useCallback, useContext, useMemo, useReducer, type ReactNode } from 'react';
import type { InvestigationAction } from './reducer';
import { createInvestigationState, type InvestigationDefaults, type InvestigationState } from './types';
import { breadcrumbSnapshots, createHistory, historyReducer } from './history';

interface InvestigationContextValue {
  state: InvestigationState;
  dispatch: React.Dispatch<InvestigationAction>;
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
  breadcrumbs: InvestigationState[];
}

const Context = createContext<InvestigationContextValue | null>(null);

export function InvestigationProvider({ children, defaults }: { children: ReactNode; defaults?: InvestigationDefaults }) {
  const [history, historyDispatch] = useReducer(historyReducer, defaults, (value) => createHistory(createInvestigationState(value)));
  const dispatch = useCallback<React.Dispatch<InvestigationAction>>((action) => historyDispatch({ type: 'investigation', action }), []);
  const goBack = useCallback(() => historyDispatch({ type: 'back' }), []);
  const goForward = useCallback(() => historyDispatch({ type: 'forward' }), []);
  const value = useMemo(() => ({ state: history.current, dispatch, canGoBack: history.back.length > 0, canGoForward: history.forward.length > 0, goBack, goForward, breadcrumbs: breadcrumbSnapshots(history) }), [history, dispatch, goBack, goForward]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useInvestigation() {
  const value = useContext(Context);
  if (!value) throw new Error('InvestigationProvider missing');
  return value;
}
