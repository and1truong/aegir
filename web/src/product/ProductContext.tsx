import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Contract, EvidenceRecord, NodeCoverage, Rule, SysEdge, SysNode, Violation } from '../data/types';
import type { SnapshotRef, Timeline } from '../temporal/timeline';

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
  ref: SnapshotRef;
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
  timeline?: Timeline;
  snapshotError?: { snapshotId: number; message: string };
  repositorySyncError?: string;
  timelineSyncError?: string;
  loading: boolean;
  error?: string;
  selectRepository: (id: string) => void;
  selectSnapshot: (id: number) => Promise<void>;
  addRepository: (path: string) => Promise<void>;
  reindex: (coveragePath?: string, telemetryPath?: string) => Promise<void>;
  refreshRepositories: () => Promise<void>;
  refreshTimeline: () => Promise<void>;
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
  const [timeline, setTimeline] = useState<Timeline>();
  const [snapshotError, setSnapshotError] = useState<{ snapshotId: number; message: string }>();
  const [repositorySyncError, setRepositorySyncError] = useState<string>();
  const [timelineSyncError, setTimelineSyncError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const snapshotRequest = useRef(0);
  const timelineRequest = useRef(0);
  const active = repositories.find((repository) => repository.id === activeID) ?? repositories[0];
  const activeRepository = useRef(active?.id);
  activeRepository.current = active?.id;

  const refreshRepositories = useCallback(async () => {
    const result = await api<{ repositories: Repository[] }>('/api/repositories');
    setRepositories(result.repositories);
    setRepositorySyncError(undefined);
    setActiveID((current) => current || result.repositories[0]?.id || current);
  }, []);

  useEffect(() => {
    refreshRepositories().catch((cause) => setError(cause.message)).finally(() => setLoading(false));
  }, [refreshRepositories]);

  useEffect(() => {
    const request = ++snapshotRequest.current;
    const timelineGeneration = ++timelineRequest.current;
    setSnapshot(undefined); setTimeline(undefined); setSnapshotError(undefined); setRepositorySyncError(undefined); setTimelineSyncError(undefined); setError(undefined);
    if (!active) { setLoading(false); return; }
    window.localStorage.setItem('aegir-repository', active.id);
    if (active.status !== 'ready') { setLoading(false); return; }
    setLoading(true);
    api<ProductSnapshot>(`/api/repositories/${active.id}/graph`)
      .then((nextSnapshot) => { if (request === snapshotRequest.current) { setSnapshot(nextSnapshot); setError(undefined) } })
      .catch((cause) => { if (request === snapshotRequest.current) setError(cause.message) })
      .finally(() => { if (request === snapshotRequest.current) setLoading(false) });
    api<Timeline>(`/api/repositories/${active.id}/timeline`)
      .then((nextTimeline) => { if (timelineGeneration === timelineRequest.current && activeRepository.current === active.id) { setTimeline(nextTimeline); setTimelineSyncError(undefined) } })
      .catch((cause) => { if (timelineGeneration === timelineRequest.current && activeRepository.current === active.id) setTimelineSyncError(cause instanceof Error ? cause.message : String(cause)) });
  }, [active?.id, active?.status]);

  const addRepository = useCallback(async (path: string) => {
    setLoading(true); setError(undefined);
    try {
      const indexed = await api<ProductSnapshot>('/api/repositories', { method: 'POST', body: JSON.stringify({ path, index: true }) });
      setSnapshot(indexed); setActiveID(indexed.repository.id); await refreshRepositories();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); throw cause }
    finally { setLoading(false) }
  }, [refreshRepositories]);

  const refreshTimeline = useCallback(async () => {
    if (!active) return;
    const repositoryID = active.id;
    const request = ++timelineRequest.current;
    try {
      const nextTimeline = await api<Timeline>(`/api/repositories/${repositoryID}/timeline`);
      if (request === timelineRequest.current && activeRepository.current === repositoryID) { setTimeline(nextTimeline); setTimelineSyncError(undefined) }
    } catch (cause) {
      if (request === timelineRequest.current && activeRepository.current === repositoryID) throw cause;
    }
  }, [active]);

  const reindex = useCallback(async (coveragePath?: string, telemetryPath?: string) => {
    if (!active) return;
    const repositoryID = active.id;
    const request = ++snapshotRequest.current;
    setLoading(true); setError(undefined); setRepositorySyncError(undefined); setTimelineSyncError(undefined);
    let indexed: ProductSnapshot;
    try {
      indexed = await api<ProductSnapshot>(`/api/repositories/${repositoryID}/index`, { method: 'POST', body: JSON.stringify({ coveragePath: coveragePath ?? '', telemetryPath: telemetryPath ?? '' }) });
    }
    catch (cause) {
      if (request === snapshotRequest.current && activeRepository.current === repositoryID) { setError(cause instanceof Error ? cause.message : String(cause)); setLoading(false) }
      return;
    }
    if (request !== snapshotRequest.current || activeRepository.current !== repositoryID) return;
    setSnapshot(indexed);
    await Promise.all([
      refreshRepositories().catch((cause) => { if (request === snapshotRequest.current) setRepositorySyncError(cause instanceof Error ? cause.message : String(cause)) }),
      refreshTimeline().catch((cause) => { if (request === snapshotRequest.current) setTimelineSyncError(cause instanceof Error ? cause.message : String(cause)) }),
    ]);
    if (request === snapshotRequest.current) setLoading(false);
  }, [active, refreshRepositories, refreshTimeline]);

  const selectSnapshot = useCallback(async (id: number) => {
    const request = ++snapshotRequest.current;
    if (!active) return;
    if (id === snapshot?.id) { setLoading(false); return }
    setLoading(true); setSnapshotError(undefined); setError(undefined);
    try {
      const selected = await api<ProductSnapshot>(`/api/repositories/${active.id}/graph?snapshot=${id}`);
      if (request === snapshotRequest.current) { setSnapshot(selected); setSnapshotError(undefined) }
    }
    catch (cause) { if (request === snapshotRequest.current) setSnapshotError({ snapshotId: id, message: cause instanceof Error ? cause.message : String(cause) }) }
    finally { if (request === snapshotRequest.current) setLoading(false) }
  }, [active, snapshot?.id]);

  const selectRepository = useCallback((id: string) => { if (id === activeRepository.current) return; snapshotRequest.current += 1; timelineRequest.current += 1; setSnapshotError(undefined); setRepositorySyncError(undefined); setTimelineSyncError(undefined); setError(undefined); setActiveID(id) }, []);
  const value = useMemo<ProductState>(() => ({ repositories, active, snapshot, timeline, snapshotError, repositorySyncError, timelineSyncError, loading, error, selectRepository, selectSnapshot, addRepository, reindex, refreshRepositories, refreshTimeline, clearError: () => setError(undefined) }), [repositories, active, snapshot, timeline, snapshotError, repositorySyncError, timelineSyncError, loading, error, selectRepository, selectSnapshot, addRepository, reindex, refreshRepositories, refreshTimeline]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useProduct() {
  const value = useContext(Context);
  if (!value) throw new Error('ProductProvider missing');
  return value;
}
