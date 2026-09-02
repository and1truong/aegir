import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Contract, EvidenceRecord, NodeCoverage, Rule, SysEdge, SysNode, Violation } from '../data/types';

export interface Repository {
  id: string;
  name: string;
  path: string;
  module?: string;
  head?: string;
  status: 'registered' | 'indexing' | 'ready' | 'error';
  lastIndexedAt?: string;
  error?: string;
}

export interface ProductSnapshot {
  id: number;
  createdAt: string;
  repository: Repository;
  nodes: SysNode[];
  edges: SysEdge[];
  evidence: EvidenceRecord[];
  analysis: {
    rules: Rule[];
    violations: Violation[];
    coverage: NodeCoverage[];
    contracts: Contract[];
    complexity: { nodeId: string; cyclomatic: number; loc: number; fanIn: number; fanOut: number; score: number }[];
    telemetry: { nodeId: string; rpm?: number; qps?: number; p50?: number; p95?: number; p99?: number; errorRate?: number; window: string; source: string; note?: string }[];
  };
  stats: Record<string, number>;
}

interface ProductState {
  repositories: Repository[];
  active?: Repository;
  snapshot?: ProductSnapshot;
  loading: boolean;
  error?: string;
  selectRepository: (id: string) => void;
  addRepository: (path: string) => Promise<void>;
  reindex: (coveragePath?: string, telemetryPath?: string) => Promise<void>;
  clearError: () => void;
}

const Context = createContext<ProductState | null>(null);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body as T;
}

export function ProductProvider({ children }: { children: React.ReactNode }) {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [activeID, setActiveID] = useState(() => window.localStorage.getItem('aegir-repository') ?? '');
  const [snapshot, setSnapshot] = useState<ProductSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const active = repositories.find((repository) => repository.id === activeID) ?? repositories[0];

  const refreshRepositories = useCallback(async () => {
    const result = await api<{ repositories: Repository[] }>('/api/repositories');
    setRepositories(result.repositories);
    if (!activeID && result.repositories[0]) setActiveID(result.repositories[0].id);
  }, [activeID]);

  useEffect(() => {
    refreshRepositories().catch((cause) => setError(cause.message)).finally(() => setLoading(false));
  }, [refreshRepositories]);

  useEffect(() => {
    if (!active) { setSnapshot(undefined); return; }
    window.localStorage.setItem('aegir-repository', active.id);
    if (active.status !== 'ready') { setSnapshot(undefined); return; }
    setLoading(true);
    api<ProductSnapshot>(`/api/repositories/${active.id}/graph`)
      .then(setSnapshot)
      .catch((cause) => setError(cause.message))
      .finally(() => setLoading(false));
  }, [active?.id, active?.status]);

  const addRepository = useCallback(async (path: string) => {
    setLoading(true); setError(undefined);
    try {
      const indexed = await api<ProductSnapshot>('/api/repositories', { method: 'POST', body: JSON.stringify({ path, index: true }) });
      setSnapshot(indexed); setActiveID(indexed.repository.id); await refreshRepositories();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause }
    finally { setLoading(false) }
  }, [refreshRepositories]);

  const reindex = useCallback(async (coveragePath?: string, telemetryPath?: string) => {
    if (!active) return;
    setLoading(true); setError(undefined);
    try { const indexed = await api<ProductSnapshot>(`/api/repositories/${active.id}/index`, { method: 'POST', body: JSON.stringify({ coveragePath: coveragePath ?? '', telemetryPath: telemetryPath ?? '' }) }); setSnapshot(indexed); await refreshRepositories() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  }, [active, refreshRepositories]);

  const value = useMemo<ProductState>(() => ({ repositories, active, snapshot, loading, error, selectRepository: setActiveID, addRepository, reindex, clearError: () => setError(undefined) }), [repositories, active, snapshot, loading, error, addRepository, reindex]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProduct() {
  const value = useContext(Context);
  if (!value) throw new Error('ProductProvider missing');
  return value;
}
