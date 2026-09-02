import { createContext, useContext, useMemo, useReducer, type ReactNode } from 'react';
import { investigationReducer, type InvestigationAction } from './reducer';
import { createInvestigationState, type InvestigationDefaults, type InvestigationState } from './types';

interface InvestigationContextValue {
  state: InvestigationState;
  dispatch: React.Dispatch<InvestigationAction>;
}

const Context = createContext<InvestigationContextValue | null>(null);

export function InvestigationProvider({ children, defaults }: { children: ReactNode; defaults?: InvestigationDefaults }) {
  const [state, dispatch] = useReducer(investigationReducer, defaults, createInvestigationState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useInvestigation() {
  const value = useContext(Context);
  if (!value) throw new Error('InvestigationProvider missing');
  return value;
}
