import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, Database, FileCode2, GitBranch, GitCompare, GitPullRequest,
  LayoutDashboard, Loader2, Maximize2, Minimize2, Moon, Network, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, Plus, RefreshCw, Search, Settings, ShieldAlert, Sun,
} from 'lucide-react';
import type { EdgeKind, EvidenceRecord, GraphDelta, GraphEdgeDelta, GraphNodeDelta, SysEdge, SysNode } from '../data/types';
import { SystemGraph, type GraphDecor } from '../components/graph/SystemGraph';
import { Badge, Btn, KindIcon, SeverityBadge } from './ui';
import { cn } from '../utils/cn';
import { useProduct, type ProductSnapshot } from './ProductContext';
import { GraphScopeControls, type ExpandedBranch } from './GraphScopeControls';
import { projectGraphIndex, projectPRGraphIndex, type BranchExpansions } from '../lib/graphProjection';
import { useInvestigation } from '../investigation/InvestigationContext';
import { enabledRelationships as deriveEnabledRelationships, legacyBranchExpansions } from '../investigation/reducer';
import { reconcileMissingFocal } from '../investigation/history';
import { InvestigationBreadcrumbs } from '../investigation/InvestigationBreadcrumbs';
import { createGraphIndex } from '../graph/index';
import { abstractGraph } from '../graph/abstraction';
import { evidenceForEdge, formatEvidenceLocation } from '../graph/evidence';
import { projectionDefinitions, questionProjectionIds, signalProjectionIds } from '../graph/projection/definitions';
import { adaptGraphDelta, deltaStatusMaps, graphForReviewPolicy, graphForReviewSnapshot, type ReviewGraphPolicy } from '../review/delta';
import { pathQueryDefinitions, runPathQuery, type PathQueryId, type PathQueryResult, type SemanticPath } from '../path/query';
import { LocalStorageSavedViewRepository } from '../savedViews/repository';
import { hydrateSavedView, type SavedView } from '../savedViews/schema';
import { CommandValidationError, planAgentPhrase, previewCommands, type CommandPreview } from '../investigation/commands';
import { dependencyIntroduction } from '../temporal/timeline';
import { computeStructuralAnalytics, metricDefinitions, rankStructuralHotspots } from '../analytics/structural';
import { analyzeArchitectureEvolution, type ArchitectureEvolutionChange } from '../evolution/architecture';
import { abstractionShortcutForEvent, type ShortcutEventLike } from '../interaction/abstractionShortcuts';
import { mixedAbstractionGraph } from '../graph/mixedAbstraction';

type Screen = 'overview' | 'explorer' | 'pulls' | 'rules' | 'search' | 'settings';
type ExplorerMode = 'dependencies' | 'data flow' | 'runtime' | 'impact' | 'coverage' | 'complexity' | 'contracts' | 'lint' | 'what-can-break' | 'hot-path' | 'state-mutation' | 'retry-paths' | 'transaction-boundaries' | 'cross-team-dependencies' | 'what-changed-architecturally';

interface ContractDiff {
  baseSnapshotId: number;
  headSnapshotId: number;
  changes: { contractId: string; name: string; type: string; status: string; compatibility: 'safe' | 'conditional' | 'potential' | 'break'; fields: { kind: string; path: string; before?: string; after?: string; compat: 'safe' | 'conditional' | 'potential' | 'break'; note: string }[] }[];
}

interface LocalReview {
  payloadVersion?: number;
  id: string;
  baseRef: string;
  headRef: string;
  createdAt: string;
  baseSnapshotId: number;
  headSnapshotId: number;
  summary: { addedNodes: number; removedNodes: number; modifiedNodes: number; addedEdges: number; removedEdges: number; newViolations: number; resolvedViolations: number };
  nodes: SysNode[];
  edges: SysEdge[];
  evidence?: EvidenceRecord[];
  newViolations: { id: string; ruleId: string; title: string; detail: string }[];
  resolvedViolations: { id: string; ruleId: string; title: string; detail: string }[];
  contractDiff: ContractDiff;
  delta?: GraphDelta;
}

const NAV: [Screen, string, ComponentType<{ className?: string }>][] = [
  ['overview', 'Overview', LayoutDashboard],
  ['explorer', 'System Explorer', Network],
  ['pulls', 'Pull Requests', GitPullRequest],
  ['rules', 'Rules', ShieldAlert],
  ['search', 'Search', Search],
  ['settings', 'Settings', Settings],
];

function Onboarding() {
  const { addRepository, loading, error, clearError } = useProduct();
  const [path, setPath] = useState('');
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 p-8">
      <form
        onSubmit={(event) => { event.preventDefault(); if (path.trim()) void addRepository(path.trim()) }}
        className="w-full max-w-[560px] rounded-lg border border-zinc-800 bg-zinc-900/40 p-6"
      >
        <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-md border border-sky-800 bg-sky-950/50">
          <Network className="h-5 w-5 text-sky-300" />
        </div>
        <h1 className="text-[18px] font-semibold text-zinc-50">Index a local repository</h1>
        <p className="mt-1 text-[12px] leading-relaxed text-zinc-400">
          Aegir parses Go source locally, builds a persistent system graph, and runs deterministic architecture and test-reachability analysis. Source code never leaves this machine.
        </p>
        <label className="mt-5 block text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Absolute repository path</label>
        <div className="mt-1.5 flex gap-2">
          <input
            autoFocus value={path} onChange={(event) => { setPath(event.target.value); clearError() }}
            placeholder="/Users/you/code/service"
            className="h-9 min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 font-mono text-[12px] text-zinc-100 outline-none focus:border-sky-600"
          />
          <Btn variant="solid" disabled={loading || !path.trim()}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Index
          </Btn>
        </div>
        {error && <div className="mt-3 flex items-start gap-2 rounded-md border border-red-900/60 bg-red-950/30 p-2 text-[11px] text-red-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
        <div className="mt-5 border-t border-zinc-800 pt-3 font-mono text-[10px] text-zinc-600">Local-first v1 · Go AST · SQLite · no repository upload</div>
      </form>
    </div>
  );
}

const MODE_RELATIONSHIPS: Record<ExplorerMode, EdgeKind[]> = {
  dependencies: ['calls', 'depends_on'],
  'data flow': ['calls', 'reads', 'writes', 'transforms', 'publishes', 'consumes'],
  runtime: ['calls', 'reads', 'writes', 'publishes', 'consumes', 'depends_on'],
  impact: ['calls', 'depends_on', 'reads', 'writes', 'publishes', 'consumes'],
  coverage: ['calls', 'tests'],
  complexity: ['calls', 'depends_on'],
  contracts: ['calls', 'depends_on', 'publishes', 'consumes'],
  lint: ['calls', 'depends_on', 'reads', 'writes', 'publishes', 'consumes'],
  'what-can-break': ['calls', 'depends_on', 'implements', 'retries', 'writes', 'publishes', 'consumes'],
  'hot-path': ['calls', 'publishes', 'consumes'],
  'state-mutation': ['calls', 'writes', 'publishes'],
  'retry-paths': ['retries', 'calls'],
  'transaction-boundaries': ['calls', 'reads', 'writes'],
  'cross-team-dependencies': ['calls', 'publishes', 'consumes', 'implements'],
  'what-changed-architecturally': ['calls', 'depends_on', 'reads', 'writes', 'publishes', 'consumes', 'implements'],
};

function expandedBranchLabels(expansions: BranchExpansions, nodes: SysNode[]): ExpandedBranch[] {
  const labels = new Map(nodes.map((node) => [node.id, node.label]));
  return Object.entries(expansions).filter(([, pages]) => pages > 0).map(([key]) => {
    if (key.startsWith('frontier:')) {
      const parts = key.split(':');
      return { key, direction: parts[1] as ExpandedBranch['direction'], label: decodeURIComponent(parts.at(-1) ?? 'group') };
    }
    const [direction, encodedParentId] = key.split(':');
    const parentId = decodeURIComponent(encodedParentId);
    return { key, direction: direction as ExpandedBranch['direction'], label: labels.get(parentId) ?? 'branch' };
  });
}

function PinnedStrip({ nodeIds, nodes, unpin, clear }: { nodeIds: string[]; nodes: readonly SysNode[]; unpin: (id: string) => void; clear: () => void }) {
  if (nodeIds.length === 0) return null;
  const labels = new Map(nodes.map((node) => [node.id, node.label]));
  return <div className="flex min-h-7 items-center gap-1 border-b border-zinc-800 bg-amber-950/10 px-3"><span className="mr-1 text-[9px] font-semibold uppercase tracking-wider text-amber-500">Pinned {nodeIds.length}/5</span>{nodeIds.map((id) => <button key={id} onClick={() => unpin(id)} title="Unpin" className="rounded border border-amber-900/60 px-1.5 py-0.5 font-mono text-[9px] text-amber-200">{labels.get(id) ?? id} ×</button>)}<button onClick={clear} className="ml-auto text-[9px] text-zinc-500 hover:text-zinc-200">Clear pins</button></div>;
}

function PathQueryBar({ nodes, sourceId, targetId, queryId, result, activePath, locked, alternateCount, selectedPath, setTargetId, setQueryId, run, choosePath, lock, unlock }: { nodes: readonly SysNode[]; sourceId?: string; targetId: string; queryId: PathQueryId; result?: PathQueryResult; activePath?: SemanticPath; locked: boolean; alternateCount: number; selectedPath: number; setTargetId: (id: string) => void; setQueryId: (id: PathQueryId) => void; run: () => void; choosePath: (index: number) => void; lock: () => void; unlock: () => void }) {
  const paths = result?.path ? [result.path, ...result.alternatives] : [];
  return <div className="flex min-h-8 items-center gap-2 border-b border-zinc-800 bg-violet-950/10 px-3 py-1">
    <span className="text-[9px] font-semibold uppercase tracking-wider text-violet-400">Why affected?</span>
    <select aria-label="Path query type" value={queryId} onChange={(event) => setQueryId(event.target.value as PathQueryId)} className="h-6 rounded border border-zinc-800 bg-zinc-950 px-1.5 text-[10px] text-zinc-300">{Object.values(pathQueryDefinitions).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
    <span className="text-[10px] text-zinc-600">to</span>
    <select aria-label="Path target" value={targetId} onChange={(event) => setTargetId(event.target.value)} className="h-6 max-w-[220px] rounded border border-zinc-800 bg-zinc-950 px-1.5 font-mono text-[10px] text-zinc-300"><option value="">Choose target…</option>{nodes.filter((node) => node.id !== sourceId).map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}</select>
    <button onClick={run} disabled={!sourceId || !targetId || locked} className="h-6 rounded border border-violet-800 px-2 text-[9px] text-violet-200 disabled:opacity-40">Find path</button>
    {activePath && <><span className="ml-auto text-[9.5px] text-zinc-400">{locked && <span className="mr-1 text-violet-300">LOCKED ·</span>}{activePath.semanticHops} semantic hops · {alternateCount} alternate{alternateCount === 1 ? '' : 's'}</span>{!locked && paths.length > 1 && <select aria-label="Path result" value={selectedPath} onChange={(event) => choosePath(Number(event.target.value))} className="h-6 rounded border border-zinc-800 bg-zinc-950 px-1 text-[9.5px] text-zinc-300">{paths.map((path, index) => <option key={path.id} value={index}>{index === 0 ? 'Best path' : `Alternative ${index}`}</option>)}</select>}<button onClick={locked ? unlock : lock} className="h-6 rounded border border-violet-800 px-2 text-[9px] text-violet-200">{locked ? 'Unlock path' : 'Lock path'}</button></>}
    {result?.noPath && <span className="ml-auto text-[9.5px] text-amber-300">{result.noPath.message}</span>}
  </div>;
}

function SavedViewsBar({ views, name, selectedId, status, setName, setSelectedId, save, load, remove }: { views: SavedView[]; name: string; selectedId: string; status: string; setName: (name: string) => void; setSelectedId: (id: string) => void; save: () => void; load: () => void; remove: () => void }) {
  return <div className="flex min-h-8 items-center gap-2 border-b border-zinc-800 bg-emerald-950/10 px-3 py-1">
    <span className="text-[9px] font-semibold uppercase tracking-wider text-emerald-500">Saved views</span>
    <input aria-label="Saved view name" value={name} onChange={(event) => setName(event.target.value)} placeholder="View name" className="h-6 w-[130px] rounded border border-zinc-800 bg-zinc-950 px-1.5 text-[10px] text-zinc-300 outline-none" />
    <button onClick={save} disabled={!name.trim()} className="h-6 rounded border border-emerald-900 px-2 text-[9px] text-emerald-300 disabled:opacity-40">Save current</button>
    <select aria-label="Saved view" value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="h-6 max-w-[180px] rounded border border-zinc-800 bg-zinc-950 px-1.5 text-[10px] text-zinc-300"><option value="">Choose view…</option>{views.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}</select>
    <button onClick={load} disabled={!selectedId} className="h-6 rounded border border-zinc-700 px-2 text-[9px] text-zinc-300 disabled:opacity-40">Load</button>
    <button onClick={remove} disabled={!selectedId} className="h-6 px-1 text-[9px] text-zinc-500 disabled:opacity-40">Delete</button>
    {status && <span className="ml-auto truncate text-[9.5px] text-amber-300">{status}</span>}
  </div>;
}

function AgentActionBar({ preview, applied, error, propose, apply, dismiss, undo }: { preview?: CommandPreview; applied?: string; error: string; propose: () => void; apply: () => void; dismiss: () => void; undo: () => void }) {
  return <div className="flex min-h-8 items-center gap-2 border-b border-zinc-800 bg-sky-950/10 px-3 py-1">
    <span className="text-[9px] font-semibold uppercase tracking-wider text-sky-400">Agent actions</span>
    {!preview && !applied && <button onClick={propose} className="h-6 rounded border border-sky-900 px-2 text-[9px] text-sky-300">Preview risky PR paths</button>}
    {preview && <><span className="max-w-[420px] truncate text-[9.5px] text-zinc-400">Preview · {preview.changes.map((change) => change.field).join(', ') || 'no state changes'} · revision {preview.revision.length}b</span><button onClick={apply} className="h-6 rounded border border-sky-700 bg-sky-950 px-2 text-[9px] text-sky-200">Apply {preview.batch.commands.length} commands</button><button onClick={dismiss} className="text-[9px] text-zinc-500">Dismiss</button></>}
    {applied && <><span className="text-[9.5px] text-sky-300">Agent applied · {applied}</span><button onClick={undo} className="h-6 rounded border border-zinc-700 px-2 text-[9px] text-zinc-300">Undo</button></>}
    {error && <span className="ml-auto text-[9.5px] text-red-300">{error}</span>}
  </div>;
}

interface GraphViewProps {
  theme: 'light' | 'dark';
  focusMode: boolean;
  setFocusMode: (value: boolean) => void;
}

function Explorer({ theme, focusMode, setFocusMode }: GraphViewProps) {
  const { active, snapshot, timeline, selectSnapshot } = useProduct();
  const { state: investigation, dispatch, goBack } = useInvestigation();
  const mode = investigation.projectionId as ExplorerMode;
  const selected = investigation.focalNodeId;
  const { upstream: upstreamDepth, downstream: downstreamDepth } = investigation.depth;
  const enabledRelationships = useMemo(
    () => deriveEnabledRelationships(investigation, MODE_RELATIONSHIPS[mode]),
    [investigation, mode],
  );
  const branchExpansions = useMemo(() => legacyBranchExpansions(investigation), [investigation]);
  const [query, setQuery] = useState('');
  const [pathTargetId, setPathTargetId] = useState('');
  const [pathQueryId, setPathQueryId] = useState<PathQueryId>('semantic-dependency');
  const [pathResult, setPathResult] = useState<PathQueryResult>();
  const [selectedPathIndex, setSelectedPathIndex] = useState(0);
  const savedViewRepository = useMemo(() => new LocalStorageSavedViewRepository(window.localStorage), []);
  const [savedViews, setSavedViews] = useState(() => savedViewRepository.list());
  const [savedViewName, setSavedViewName] = useState('Investigation');
  const [selectedSavedViewId, setSelectedSavedViewId] = useState('');
  const [savedViewStatus, setSavedViewStatus] = useState('');
  const [commandPreview, setCommandPreview] = useState<CommandPreview>();
  const [commandError, setCommandError] = useState('');
  const [agentApplied, setAgentApplied] = useState('');
  const [mixedDetail, setMixedDetail] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [contractDiff, setContractDiff] = useState<ContractDiff>();
  const nodes = snapshot?.nodes ?? [];
  const edges = snapshot?.edges ?? [];
  const canonicalGraphIndex = useMemo(() => createGraphIndex(nodes, edges, snapshot?.evidence ?? [], {
    telemetry: snapshot?.analysis.telemetry,
    findingNodeIds: snapshot?.analysis.violations.flatMap((violation) => violation.path.length ? violation.path : [violation.primaryNode]),
  }), [nodes, edges, snapshot?.evidence, snapshot?.analysis.telemetry, snapshot?.analysis.violations]);
  const abstractionGraph = useMemo(() => mixedDetail ? mixedAbstractionGraph(canonicalGraphIndex, investigation.abstraction, selected) : abstractGraph(canonicalGraphIndex, investigation.abstraction), [canonicalGraphIndex, investigation.abstraction, selected, mixedDetail]);
  const mixedBranch = mixedDetail ? (abstractionGraph as import('../graph/mixedAbstraction').MixedAbstractionGraph).branch : undefined;
  const graphIndex = abstractionGraph.index;
  const structuralAnalytics = useMemo(() => computeStructuralAnalytics({ repositoryId: active?.id ?? 'none', snapshotId: snapshot?.id ?? 0, abstraction: investigation.abstraction, nodes: graphIndex.nodes, edges: graphIndex.edges }), [active?.id, snapshot?.id, investigation.abstraction, graphIndex]);
  const projectedSelected = selected ? abstractionGraph.canonicalToRepresentative.get(selected) : undefined;
  const projectedPins = useMemo(() => [...new Set(investigation.pinnedNodeIds.flatMap((id) => abstractionGraph.canonicalToRepresentative.get(id) ?? []))], [investigation.pinnedNodeIds, abstractionGraph]);
  const pathOptions = pathResult?.path ? [pathResult.path, ...pathResult.alternatives] : [];
  const lockedSemanticPath: SemanticPath | undefined = investigation.lockedPath ? { id: investigation.lockedPath.id, queryId: investigation.lockedPath.queryId as PathQueryId, nodeIds: investigation.lockedPath.nodeIds, edgeIds: investigation.lockedPath.edgeIds, steps: [], semanticHops: investigation.lockedPath.semanticHops, evidencePenalty: 0, explanation: 'Locked semantic path.' } : undefined;
  const activePath: SemanticPath | undefined = lockedSemanticPath ?? pathOptions[selectedPathIndex];

  useEffect(() => {
    dispatch({ type: 'resetContext', contextKey: `snapshot:${active?.id ?? 'none'}:${snapshot?.id ?? 'none'}`, projectionId: 'dependencies' });
    setContractDiff(undefined);
    setPathResult(undefined);
    setPathTargetId('');
    setSavedViewStatus('');
    setCommandPreview(undefined);
    setAgentApplied('');
    setCommandError('');
    setMixedDetail(false);
  }, [active?.id, snapshot?.id, dispatch]);
  useEffect(() => { setPathResult(undefined); setSelectedPathIndex(0) }, [projectedSelected, pathQueryId, investigation.evidencePolicy.maximumLevel, investigation.evidencePolicy.includeStale]);
  useEffect(() => {
    if (mode !== 'contracts' || !active) return;
    fetch(`/api/repositories/${active.id}/contracts/diff`).then((response) => response.json()).then(setContractDiff);
  }, [mode, active, snapshot?.id]);

  const violations = snapshot?.analysis.violations ?? [];
  const lintRoots = mode === 'lint' && !selected ? [...new Set(violations.flatMap((violation) => violation.path.length ? violation.path : [violation.primaryNode]).flatMap((id) => abstractionGraph.canonicalToRepresentative.get(id) ?? []))] : undefined;
  const graph = useMemo(() => projectGraphIndex(graphIndex, {
    projectionId: mode,
    activeNodeId: projectedSelected,
    rootNodeIds: lintRoots,
    upstreamDepth,
    downstreamDepth,
    edgeKinds: enabledRelationships,
    branchExpansions,
    nodeBudget: 30,
    evidencePolicy: investigation.evidencePolicy,
    pinnedNodeIds: projectedPins,
    lockedPath: activePath ? { nodeIds: activePath.nodeIds, edgeIds: activePath.edgeIds } : undefined,
  }), [graphIndex, mode, projectedSelected, lintRoots, upstreamDepth, downstreamDepth, enabledRelationships, branchExpansions, investigation.evidencePolicy, projectedPins, activePath]);
  const selectedEdgeId = investigation.selectedEntity?.kind === 'edge' ? investigation.selectedEntity.id : undefined;
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedEdgeIntroduction = selectedEdgeId && timeline ? dependencyIntroduction(selectedEdgeId, timeline) : undefined;
  const selectedVisibleEdge = graph.visibleGraph.edges.find((edge) => edge.kind === 'real' && edge.id === selectedEdgeId);
  const selectedVisibleNode = graph.visibleGraph.nodes.find((item) => item.kind === 'real' && item.id === projectedSelected);
  const selectedFrontierId = investigation.selectedEntity?.kind === 'frontier' ? investigation.selectedEntity.id : undefined;
  const selectedFrontier = graph.visibleGraph.nodes.find((item) => item.kind === 'frontier' && item.frontier.id === selectedFrontierId);
  useEffect(() => {
    if (selectedEdgeId && !selectedEdge) dispatch({ type: 'selectEntity', entity: selected ? { kind: 'node', id: selected } : null });
  }, [selectedEdgeId, selectedEdge, selected, dispatch]);
  const coverage = useMemo(() => new Map(snapshot?.analysis.coverage.map((item) => [item.nodeId, item]) ?? []), [snapshot]);
  const complexity = useMemo(() => new Map((snapshot?.analysis.complexity ?? []).map((item) => [item.nodeId, item])), [snapshot]);
  const structuralHotspots = useMemo(() => rankStructuralHotspots(structuralAnalytics, { complexityByNode: new Map([...complexity].map(([id, item]) => [id, item.score])) }), [structuralAnalytics, complexity]);
  const telemetry = useMemo(() => new Map((snapshot?.analysis.telemetry ?? []).map((item) => [item.nodeId, item])), [snapshot]);
  const decor = useMemo<GraphDecor>(() => {
    const value: GraphDecor = { tone: {}, badges: {}, sub: {}, markers: {}, heat: {}, metrics: {} };
    if (selected) value.dimmed = new Set([...graph.retainedContext].filter((id) => id !== selected));
    for (const node of graph.nodes) {
      if (node.file) value.sub![node.id] = node.file;
      if (mixedDetail && node.abstractionLevel) value.badges![node.id] = [...(value.badges![node.id] ?? []), { text: node.abstractionLevel.toUpperCase(), tone: node.abstractionLevel === investigation.abstraction ? 'neutral' : 'violet' }];
      if (mode === 'coverage') {
        const item = coverage.get(node.id);
        if (item) {
          value.tone![node.id] = item.status;
          value.badges![node.id] = [{ text: item.line !== undefined ? `${item.line}%` : item.status.toUpperCase(), tone: item.status === 'covered' ? 'green' : item.status === 'partial' ? 'amber' : item.status === 'unknown' ? 'neutral' : 'red' }];
        }
      }
      if (mode === 'contracts') {
        const change = contractDiff?.changes.find((item) => item.contractId === node.id);
        value.tone![node.id] = change?.compatibility ?? 'contract';
        value.badges![node.id] = [{ text: change ? `${change.status.toUpperCase()} · ${change.compatibility.toUpperCase()}` : 'UNCHANGED', tone: change?.compatibility === 'break' ? 'red' : change?.compatibility === 'potential' ? 'orange' : change ? 'green' : 'violet' }];
      }
      if (mode === 'complexity') {
        const item = complexity.get(node.id);
        if (item) {
          value.heat![node.id] = item.score / 10;
          if (item.score >= 7) value.tone![node.id] = 'hot';
          value.badges![node.id] = [{ text: `SCORE ${item.score}/10`, tone: item.score >= 7 ? 'orange' : item.score >= 4 ? 'amber' : 'green' }];
          value.metrics![node.id] = [`CYC ${item.cyclomatic}`, `LOC ${item.loc}`, `IN ${item.fanIn}`, `OUT ${item.fanOut}`];
        }
      }
      if (mode === 'data flow') {
        value.edgeTone ??= {};
        value.edgeLabel ??= {};
        for (const edge of graph.edges) {
          value.edgeTone[edge.id] = edge.boundary === 'network' ? 'network' : edge.boundary === 'async' ? 'async' : edge.boundary === 'persistence' ? 'persistence' : edge.kind === 'reads' ? 'reads' : edge.kind === 'writes' ? 'writes' : edge.kind === 'publishes' ? 'publishes' : edge.kind === 'consumes' ? 'consumes' : edge.kind === 'calls' ? 'calls' : 'default';
          value.edgeLabel[edge.id] = edge.label ? `${edge.kind} · ${edge.label}` : edge.kind;
        }
      }
      if (mode === 'runtime') {
        const item = telemetry.get(node.id);
        if (item) {
          if ((item.errorRate ?? 0) >= 1) value.tone![node.id] = 'hot';
          value.badges![node.id] = [{ text: 'MEASURED', tone: (item.errorRate ?? 0) >= 1 ? 'orange' : 'cyan' }];
          value.metrics![node.id] = [item.rpm ? `${item.rpm.toLocaleString()} rpm` : '', item.qps ? `${item.qps.toLocaleString()} qps` : '', item.p99 ? `p99 ${item.p99}ms` : '', item.errorRate !== undefined ? `${item.errorRate}% errors` : ''].filter(Boolean);
        }
      }
      if (mode === 'impact') {
        const visibleNode = graph.visibleGraph.nodes.find((item) => item.kind === 'real' && item.id === node.id);
        const hop = visibleNode?.reason.kind === 'traversal' ? visibleNode.reason.semanticDepth : 0;
        value.tone![node.id] = hop === 0 ? 'root' : hop === 1 ? 'direct' : 'transitive';
        value.badges![node.id] = [{ text: hop === 0 ? 'ROOT' : `HOP ${hop}`, tone: hop === 0 ? 'amber' : 'blue' }];
      }
    }
    if (mode === 'lint') {
      for (const violation of violations) {
        value.tone![violation.primaryNode] = 'violation';
        const severity = snapshot?.analysis.rules.find((rule) => rule.id === violation.ruleId)?.severity ?? 'medium';
        value.markers![violation.primaryNode] = [...(value.markers![violation.primaryNode] ?? []), { id: violation.id, severity, ruleId: violation.ruleId }];
      }
    }
    for (const id of projectedPins) value.badges![id] = [...(value.badges![id] ?? []), { text: 'PIN', tone: 'amber' }];
    if (activePath) {
      value.highlight = new Set(activePath.nodeIds);
      value.dimmed = new Set(graph.nodes.filter((node) => !activePath.nodeIds.includes(node.id)).map((node) => node.id));
      value.edgeHighlight = new Set(activePath.edgeIds);
      value.edgeDimmed = new Set(graph.edges.filter((edge) => !activePath.edgeIds.includes(edge.id)).map((edge) => edge.id));
      value.edgeTone ??= {};
      for (const edgeId of activePath.edgeIds) value.edgeTone[edgeId] = 'highlight';
      for (const edge of graph.visibleGraph.edges) if (edge.kind === 'real' && edge.broken) value.edgeTone[edge.id] = 'warn';
    }
    return value;
  }, [graph.nodes, graph.edges, graph.visibleGraph.nodes, mode, coverage, complexity, telemetry, violations, snapshot, contractDiff, projectedPins, activePath, mixedDetail, investigation.abstraction]);

  const selectedNode = projectedSelected ? graphIndex.nodeById.get(projectedSelected) : undefined;
  useEffect(() => {
    if (!selected || nodes.length === 0 || nodes.some((node) => node.id === selected)) return;
    dispatch({ type: 'reconcileFocalNode', nodeId: reconcileMissingFocal(investigation, new Set(nodes.map((node) => node.id)), graph.visibleGraph.rootNodeIds[0] ?? nodes[0]?.id) });
  }, [selected, nodes, investigation, graph.visibleGraph.rootNodeIds, dispatch]);
  const modeNodes = mode === 'contracts' ? nodes.filter((node) => node.kind === 'contract') : mode === 'lint' ? nodes.filter((node) => violations.some((violation) => violation.primaryNode === node.id || violation.path.includes(node.id))) : nodes;
  const filtered = modeNodes.filter((node) => !query || `${node.label} ${node.file ?? ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 300);
  const selectGraphNode = (id: string) => {
    const aggregate = graph.aggregates.find((item) => item.nodeId === id);
    if (aggregate) {
      dispatch({ type: 'selectEntity', entity: { kind: 'frontier', id: aggregate.branchKey } });
      return;
    }
    dispatch({ type: 'setFocalNode', nodeId: id });
  };
  const expandGraphNode = (id: string) => {
    const aggregate = graph.aggregates.find((item) => item.nodeId === id);
    if (aggregate) dispatch({ type: 'expandFrontier', frontierId: aggregate.branchKey, beyondDepth: !aggregate.withinDepth });
    else dispatch({ type: 'setFocalNode', nodeId: id });
  };
  const toggleRelationship = (kind: EdgeKind) => dispatch({
    type: 'setRelationshipOverride',
    kind,
    value: enabledRelationships.has(kind) ? 'exclude' : 'include',
  });
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!focusMode && <div className="flex min-h-10 items-center gap-1 border-b border-zinc-800 px-3 py-1">
        <select aria-label="Investigation question" value={questionProjectionIds.includes(mode) ? mode : ''} onChange={(event) => event.target.value && dispatch({ type: 'setProjection', projectionId: event.target.value })} className="h-7 max-w-[205px] rounded-md border border-sky-900/70 bg-sky-950/30 px-2 text-[11px] text-sky-200 outline-none"><option value="">Ask a graph question…</option>{questionProjectionIds.map((id) => <option key={id} value={id}>{projectionDefinitions[id].label}</option>)}</select>
        <span className="mx-1 h-5 w-px bg-zinc-800" />
        {signalProjectionIds.map((item) => <button key={item} onClick={() => dispatch({ type: 'setProjection', projectionId: item })} className={cn('rounded-md px-2 py-1.5 text-[11px] capitalize', mode === item ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900')}>{item}</button>)}
        {timeline && timeline.snapshots.length > 1 && <select aria-label="Repository snapshot" value={snapshot?.id ?? ''} onChange={(event) => void selectSnapshot(Number(event.target.value))} className="ml-1 h-7 max-w-[180px] rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-[9.5px] text-zinc-300">{[...timeline.snapshots].reverse().map((item) => <option key={item.snapshotId} value={item.snapshotId}>{item.commit?.slice(0, 10) || `snapshot ${item.snapshotId}`} · {item.kind}</option>)}</select>}
        <span className="ml-auto font-mono text-[10px] text-zinc-500">{graph.nodes.length} nodes · {graph.edges.length} edges</span>
        <button onClick={() => setInspectorOpen((value) => !value)} aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} title={inspectorOpen ? 'Hide inspector' : 'Show inspector'} className="ml-1 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">{inspectorOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}</button>
        <button onClick={() => setFocusMode(true)} aria-label="Enter focus mode" title="Focus mode" className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><Maximize2 className="h-3.5 w-3.5" /></button>
      </div>}
      {!focusMode && projectionDefinitions[mode]?.category === 'question' && <div className="flex items-center gap-3 border-b border-zinc-800 bg-sky-950/10 px-3 py-1.5 text-[10.5px]"><span className="font-semibold text-sky-200">{projectionDefinitions[mode].label}</span><span className="text-zinc-500">{projectionDefinitions[mode].description}</span>{graph.visibleGraph.warnings.map((warning) => <span key={`${warning.code}:${warning.message}`} className="ml-auto text-amber-300">{warning.message}</span>)}</div>}
      {!focusMode && mode === 'complexity' && <div className="flex min-h-8 items-center gap-3 border-b border-zinc-800 bg-orange-950/10 px-3 text-[9.5px] text-zinc-400"><span className="font-semibold uppercase tracking-wider text-orange-400">Structural analytics v{structuralAnalytics.version}</span><span>{structuralAnalytics.cycles.length} cycles</span><span>{Math.round(structuralAnalytics.ownershipBoundaryDensity * 100)}% ownership-boundary density</span>{structuralHotspots[0] && <button onClick={() => dispatch({ type: 'setFocalNode', nodeId: structuralHotspots[0].nodeId })} className="ml-auto rounded border border-orange-900 px-2 py-1 text-orange-200">Focus top hotspot · {graphIndex.nodeById.get(structuralHotspots[0].nodeId)?.label ?? structuralHotspots[0].nodeId}</button>}</div>}
      {!focusMode && selected && investigation.abstraction !== 'symbol' && <div className="flex min-h-8 items-center gap-2 border-b border-zinc-800 bg-violet-950/10 px-3 text-[9.5px]"><span className="font-semibold uppercase tracking-wider text-violet-400">Mixed abstraction · experimental</span>{mixedBranch ? <><span className="text-zinc-400">Global {mixedBranch.globalLevel} · one focal branch at {mixedBranch.detailLevel}</span><button onClick={() => setMixedDetail(false)} className="ml-auto rounded border border-violet-900 px-2 py-1 text-violet-200">Collapse detail branch</button></> : <><span className="text-zinc-500">Reveal one focal branch exactly one level below global.</span><button onClick={() => setMixedDetail(true)} className="ml-auto rounded border border-violet-900 px-2 py-1 text-violet-200">Focus branch detail</button></>}</div>}
      {!focusMode && <InvestigationBreadcrumbs nodes={nodes} />}
      {!focusMode && <AgentActionBar preview={commandPreview} applied={agentApplied} error={commandError} propose={() => { try { const phrase = 'Show only risky paths introduced by this PR.'; const batch = planAgentPhrase(phrase, investigation.contextKey, nodes.filter((node) => node.pr).map((node) => node.id)); const preview = previewCommands(investigation, batch, { nodeIds: new Set(canonicalGraphIndex.nodeById.keys()), edgeIds: new Set(canonicalGraphIndex.edgeById.keys()), frontierIds: new Set(graph.aggregates.map((item) => item.branchKey)), projectionIds: new Set(Object.keys(projectionDefinitions)), savedViews: new Map(savedViews.map((view) => [view.id, view])), graphIndex: canonicalGraphIndex }); setCommandPreview(preview); setCommandError('') } catch (error) { setCommandError(error instanceof CommandValidationError || error instanceof Error ? error.message : 'Could not preview commands.') } }} apply={() => { if (!commandPreview) return; dispatch({ type: 'hydrateView', state: commandPreview.state }); setAgentApplied(commandPreview.batch.provenance.label); setCommandPreview(undefined); setCommandError('') }} dismiss={() => setCommandPreview(undefined)} undo={() => { goBack(); setAgentApplied('') }} />}
      {!focusMode && <SavedViewsBar views={savedViews} name={savedViewName} selectedId={selectedSavedViewId} status={savedViewStatus} setName={setSavedViewName} setSelectedId={setSelectedSavedViewId} save={() => { try { const saved = savedViewRepository.save(savedViewName, investigation); setSavedViews(savedViewRepository.list()); setSelectedSavedViewId(saved.id); setSavedViewStatus(`Saved “${saved.name}”.`) } catch (error) { setSavedViewStatus(error instanceof Error ? error.message : 'Could not save view.') } }} load={() => { const view = savedViews.find((item) => item.id === selectedSavedViewId); if (!view) return; const restored = hydrateSavedView(view, investigation.contextKey, new Set(canonicalGraphIndex.nodeById.keys()), new Set(canonicalGraphIndex.edgeById.keys())); dispatch({ type: 'hydrateView', state: restored.state }); setPathResult(undefined); setSelectedPathIndex(0); setSavedViewStatus(restored.warnings.length ? restored.warnings.map((warning) => warning.message).join(' ') : `Loaded “${view.name}”.`) }} remove={() => { try { savedViewRepository.remove(selectedSavedViewId); setSavedViews(savedViewRepository.list()); setSelectedSavedViewId(''); setSavedViewStatus('Deleted saved view.') } catch (error) { setSavedViewStatus(error instanceof Error ? error.message : 'Could not delete view.') } }} />}
      {!focusMode && <PathQueryBar nodes={graphIndex.nodes} sourceId={projectedSelected} targetId={pathTargetId} queryId={pathQueryId} result={pathResult} activePath={activePath} locked={Boolean(investigation.lockedPath)} alternateCount={investigation.lockedPath?.alternateCount ?? pathResult?.alternatives.length ?? 0} selectedPath={selectedPathIndex} setTargetId={(id) => { setPathTargetId(id); setPathResult(undefined); setSelectedPathIndex(0) }} setQueryId={setPathQueryId} choosePath={setSelectedPathIndex} run={() => { if (!projectedSelected || !pathTargetId) return; setPathResult(runPathQuery(graphIndex, { definitionId: pathQueryId, sourceNodeId: projectedSelected, targetNodeId: pathTargetId, evidencePolicy: investigation.evidencePolicy, maxAlternatives: 2 })); setSelectedPathIndex(0) }} lock={() => { const path = pathOptions[selectedPathIndex]; if (!path) return; dispatch({ type: 'lockPath', path: { id: path.id, version: 1, queryId: path.queryId, nodeIds: path.nodeIds, edgeIds: path.edgeIds, evidencePolicy: { ...investigation.evidencePolicy }, sourceNodeId: path.nodeIds[0], targetNodeId: path.nodeIds.at(-1)!, semanticHops: path.semanticHops, alternateCount: pathResult?.alternatives.length ?? 0, abstraction: investigation.abstraction } }) }} unlock={() => dispatch({ type: 'unlockPath' })} />}
      {!focusMode && <PinnedStrip nodeIds={investigation.pinnedNodeIds} nodes={nodes} unpin={(nodeId) => dispatch({ type: 'unpinNode', nodeId })} clear={() => dispatch({ type: 'clearPins' })} />}
      {!focusMode && <GraphScopeControls upstream={upstreamDepth} downstream={downstreamDepth} setUpstream={(depth) => dispatch({ type: 'setDepth', direction: 'upstream', depth })} setDownstream={(depth) => dispatch({ type: 'setDepth', direction: 'downstream', depth })} relationships={MODE_RELATIONSHIPS[mode]} enabledRelationships={enabledRelationships} toggleRelationship={toggleRelationship} evidenceLevel={investigation.evidencePolicy.maximumLevel} includeStale={investigation.evidencePolicy.includeStale} setEvidenceLevel={(maximumLevel) => dispatch({ type: 'setEvidencePolicy', maximumLevel })} setIncludeStale={(includeStale) => dispatch({ type: 'setEvidencePolicy', includeStale })} abstraction={investigation.abstraction} setAbstraction={(abstraction) => dispatch({ type: 'setAbstraction', abstraction })} expandedBranches={expandedBranchLabels(branchExpansions, nodes)} collapseBranch={(key) => dispatch({ type: 'collapseFrontier', frontierId: key })} />}
      <div className="flex min-h-0 flex-1">
        {!focusMode && <aside className="flex w-[250px] shrink-0 flex-col border-r border-zinc-800">
          <div className="border-b border-zinc-800 p-2"><div className="flex h-7 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2"><Search className="h-3.5 w-3.5 text-zinc-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter symbols…" className="w-full bg-transparent font-mono text-[11px] outline-none" /></div></div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">{filtered.map((node) => <button key={node.id} onClick={() => dispatch({ type: 'setFocalNode', nodeId: node.id })} className={cn('flex w-full items-center gap-2 px-2 py-1 text-left', selected === node.id ? 'bg-sky-500/10 text-sky-100' : 'text-zinc-300 hover:bg-zinc-900')}><KindIcon kind={node.kind} /><span className="min-w-0 flex-1 truncate font-mono text-[10.5px]">{node.label}</span></button>)}</div>
        </aside>}
        <main className="relative min-w-0 flex-1"><SystemGraph nodes={graph.nodes} edges={graph.edges} frontiers={graph.aggregates} decor={decor} selected={projectedSelected} selectedEdge={selectedEdgeId} onSelect={selectGraphNode} onEdgeSelect={(id) => dispatch({ type: 'selectEntity', entity: { kind: 'edge', id } })} onDoubleClick={expandGraphNode} anchorNodeId={projectedSelected ?? graph.visibleGraph.rootNodeIds[0]} pinnedNodeIds={projectedPins} lockedPathNodeIds={investigation.lockedPath?.nodeIds} topologyRevision={graph.visibleGraph.revision} layoutStrategy={projectionDefinitions[mode].layoutStrategy} minimap theme={theme} />{focusMode && <button onClick={() => setFocusMode(false)} aria-label="Exit focus mode" className="absolute right-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950/90 px-2.5 py-1.5 text-[11px] text-zinc-300 shadow-lg hover:bg-zinc-800"><Minimize2 className="h-3.5 w-3.5" /> Exit focus</button>}</main>
        {!focusMode && inspectorOpen && <aside className="w-[310px] shrink-0 overflow-y-auto border-l border-zinc-800 p-3">
          {selectedFrontier?.kind === 'frontier' ? <FrontierInspector frontier={selectedFrontier.frontier} expand={() => dispatch({ type: 'expandFrontier', frontierId: selectedFrontier.frontier.id, beyondDepth: !selectedFrontier.frontier.withinDepth })} /> : selectedEdge ? <EdgeInspector edge={selectedEdge} nodes={[...graphIndex.nodes]} evidence={evidenceForEdge(graphIndex, selectedEdge)} reason={selectedVisibleEdge?.reason.detail} introduced={selectedEdgeIntroduction ? `${selectedEdgeIntroduction.review.baseRef} → ${selectedEdgeIntroduction.review.headRef}` : undefined} onSelectNode={(id) => dispatch({ type: 'setFocalNode', nodeId: id })} /> : selectedNode ? <><div className="flex items-center gap-2"><KindIcon kind={selectedNode.kind} /><Badge>{selectedNode.kind}</Badge><Badge>{selectedNode.abstractionLevel ?? investigation.abstraction}</Badge><button onClick={() => dispatch({ type: investigation.pinnedNodeIds.includes(selectedNode.id) ? 'unpinNode' : 'pinNode', nodeId: selectedNode.id })} disabled={!investigation.pinnedNodeIds.includes(selectedNode.id) && investigation.pinnedNodeIds.length >= 5} className="ml-auto rounded border border-zinc-700 px-2 py-1 text-[9px] text-zinc-300 disabled:opacity-40">{investigation.pinnedNodeIds.includes(selectedNode.id) ? 'Unpin' : 'Pin'}</button></div><h2 className="mt-2 break-words font-mono text-[13px] text-zinc-50">{selectedNode.label}</h2>{selectedNode.representedNodeIds && selectedNode.representedNodeIds.length > 1 && <div className="mt-1 text-[10px] text-zinc-500">Contains {selectedNode.representedNodeIds.length} canonical nodes.</div>}<div className="mt-1 break-all font-mono text-[10px] text-zinc-500">{selectedNode.file}</div>{selectedVisibleNode?.kind === 'real' && <RankInspector score={selectedVisibleNode.score} />}{mode === 'coverage' && coverage.get(selectedNode.id) && <div className="mt-4 rounded-md border border-zinc-800 p-2"><div className="font-mono text-[18px] text-zinc-100">{coverage.get(selectedNode.id)?.line ?? '—'}%</div><div className="mt-1 text-[10px] text-zinc-500">{coverage.get(selectedNode.id)?.note}</div></div>}{mode === 'complexity' && <><>{complexity.get(selectedNode.id) && <ComplexityInspector item={complexity.get(selectedNode.id)!} />}</><StructuralInspector item={structuralAnalytics.nodes.find((item) => item.nodeId === selectedNode.id)} /></>}{mode === 'runtime' && telemetry.get(selectedNode.id) && <RuntimeInspector item={telemetry.get(selectedNode.id)!} />}{mode === 'contracts' ? <ContractInspector diff={contractDiff} contractID={selectedNode.id} /> : <div className="mt-4 border-t border-zinc-800 pt-3"><div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Relationships in scope</div>{graph.edges.filter((edge) => edge.source === projectedSelected || edge.target === projectedSelected).slice(0, 30).map((edge) => { const other = graphIndex.nodeById.get(edge.source === projectedSelected ? edge.target : edge.source); return <button key={edge.id} onClick={() => other && dispatch({ type: 'setFocalNode', nodeId: other.id })} className="mt-1 flex w-full items-center gap-2 text-left text-[10.5px] text-zinc-300 hover:text-sky-200"><Badge>{edge.kind}</Badge><span className="truncate font-mono">{other?.label}</span></button> })}</div>}</> : <div className="text-zinc-500">Select a node, edge, or frontier.</div>}
        </aside>}
      </div>
    </div>
  );
}

function EdgeInspector({ edge, nodes, evidence, reason, introduced, onSelectNode }: { edge: SysEdge; nodes: SysNode[]; evidence: EvidenceRecord[]; reason?: string; introduced?: string; onSelectNode: (id: string) => void }) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  return <div><div className="flex items-center gap-2"><Badge tone="blue">{edge.kind}</Badge>{edge.boundary && <Badge>{edge.boundary}</Badge>}{edge.sync !== undefined && <Badge>{edge.sync ? 'sync' : 'async'}</Badge>}</div><h2 className="mt-3 font-mono text-[12px] text-zinc-100">{source?.label ?? edge.source} <span className="text-zinc-600">→</span> {target?.label ?? edge.target}</h2>{introduced && <div className="mt-2 rounded border border-violet-900/60 bg-violet-950/20 p-2 text-[10px] text-violet-200">Introduced in {introduced}</div>}<div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => onSelectNode(edge.source)} className="rounded-md border border-zinc-800 p-2 text-left text-[10px] text-zinc-400 hover:border-sky-700">Source<div className="mt-1 truncate font-mono text-zinc-200">{source?.label}</div></button><button onClick={() => onSelectNode(edge.target)} className="rounded-md border border-zinc-800 p-2 text-left text-[10px] text-zinc-400 hover:border-sky-700">Target<div className="mt-1 truncate font-mono text-zinc-200">{target?.label}</div></button></div><div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Why visible</div><p className="mt-1 text-[10.5px] leading-relaxed text-zinc-300">{reason ?? 'Connects visible entities in this projection.'}</p><div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Evidence</div><div className="mt-1 space-y-2">{evidence.map((record) => <div key={record.id} className="rounded-md border border-zinc-800 p-2"><div className="flex items-center gap-2"><Badge tone={record.strength === 'proven' ? 'green' : record.strength === 'observed' ? 'blue' : 'amber'}>{record.source}</Badge><span className="text-[9px] uppercase tracking-wider text-zinc-500">{record.strength}</span></div><div className="mt-1 text-[10.5px] text-zinc-300">{record.summary}</div>{formatEvidenceLocation(record) && <div className="mt-1 break-all font-mono text-[9.5px] text-sky-300">{formatEvidenceLocation(record)}</div>}</div>)}</div></div>;
}

function FrontierInspector({ frontier, expand }: { frontier: import('../graph/types').FrontierGroup; expand: () => void }) {
  return <div><div className="flex items-center gap-2"><Badge tone="blue">{frontier.dimension}</Badge>{!frontier.withinDepth && <Badge tone="amber">beyond depth</Badge>}</div><h2 className="mt-2 font-mono text-[13px] text-zinc-100">{frontier.label}</h2><p className="mt-1 text-[10.5px] text-zinc-500">{frontier.hiddenCount} hidden nodes · aggregate score {frontier.aggregateScore.toFixed(2)}</p><div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Relationship mix</div><div className="mt-2 flex flex-wrap gap-1">{Object.entries(frontier.relationMix).map(([kind, count]) => <Badge key={kind}>{kind} · {count}</Badge>)}</div><div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Evidence summary</div><p className="mt-1 text-[10.5px] text-zinc-400">{frontier.evidenceIds.length} evidence records across this group.</p><Btn variant="solid" className="mt-4" onClick={expand}>Expand {frontier.dimension}</Btn></div>;
}

function RankInspector({ score }: { score: import('../graph/types').CandidateExplanation }) {
  return <details className="mt-3 rounded-md border border-zinc-800 p-2"><summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Why ranked · {score.total.toFixed(2)}</summary><div className="mt-2 text-[10px] text-zinc-300">{score.reason}</div>{score.components.map((component) => <div key={component.signal} className="mt-1 flex items-center gap-2 font-mono text-[9.5px]"><span className="w-[76px] text-zinc-400">{component.signal}</span><span className="text-zinc-600">{component.normalized.toFixed(2)} × {component.weight}</span><span className="ml-auto text-sky-300">+{component.contribution.toFixed(2)}</span></div>)}<pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 text-[8.5px] text-zinc-600">{JSON.stringify(score, null, 2)}</pre></details>;
}

function ComplexityInspector({ item }: { item: { cyclomatic: number; loc: number; fanIn: number; fanOut: number; score: number } }) {
  return <div className="mt-4 grid grid-cols-2 gap-2"><div className="col-span-2 rounded-md border border-zinc-800 p-2"><div className="font-mono text-[18px] text-zinc-100">{item.score}/10</div><div className="text-[10px] text-zinc-500">complexity score</div></div>{[['cyclomatic', item.cyclomatic], ['lines', item.loc], ['fan in', item.fanIn], ['fan out', item.fanOut]].map(([label, value]) => <div key={label} className="rounded-md border border-zinc-800 p-2"><div className="font-mono text-[13px] text-zinc-200">{value}</div><div className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</div></div>)}</div>;
}

function StructuralInspector({ item }: { item?: import('../analytics/structural').NodeStructuralMetrics }) {
  if (!item) return null;
  const values = [['coupling', item.coupling], ['depth', item.dependencyDepth ?? 'cycle'], ['boundary %', Math.round(item.ownershipBoundaryDensity * 100)], ['centrality', item.boundedBetweenness.toFixed(2)]];
  return <details className="mt-3 rounded-md border border-zinc-800 p-2"><summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Structural scope</summary><div className="mt-2 grid grid-cols-2 gap-1">{values.map(([label, value]) => <div key={label} className="rounded bg-zinc-950 p-1.5"><div className="font-mono text-[11px] text-zinc-200">{value}</div><div className="text-[8.5px] uppercase text-zinc-600">{label}</div></div>)}</div><div className="mt-2 text-[9px] text-zinc-500">{metricDefinitions.find((definition) => definition.id === 'bounded-betweenness')?.definition}</div><div className="mt-1 text-[9px] text-zinc-600">{item.edgeIds.length} supporting edges · {item.evidenceIds.length} evidence records</div></details>;
}

function RuntimeInspector({ item }: { item: { rpm?: number; qps?: number; p50?: number; p95?: number; p99?: number; errorRate?: number; window: string; source: string; note?: string } }) {
  const metrics = [['rpm', item.rpm], ['qps', item.qps], ['p50 ms', item.p50], ['p95 ms', item.p95], ['p99 ms', item.p99], ['errors %', item.errorRate]].filter(([, value]) => value !== undefined);
  return <div className="mt-4"><div className="grid grid-cols-2 gap-2">{metrics.map(([label, value]) => <div key={label} className="rounded-md border border-zinc-800 p-2"><div className="font-mono text-[13px] text-zinc-200">{value}</div><div className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</div></div>)}</div><div className="mt-2 text-[10px] text-zinc-500">Measured by {item.source} · {item.window} window</div>{item.note && <div className="mt-1 text-[10px] text-zinc-400">{item.note}</div>}</div>;
}

function ContractInspector({ diff, contractID }: { diff?: ContractDiff; contractID: string }) {
  const change = diff?.changes.find((item) => item.contractId === contractID);
  if (!diff?.baseSnapshotId) return <div className="mt-4 rounded-md border border-zinc-800 p-2 text-[10.5px] text-zinc-500">Index the repository again after a contract change to create a comparison baseline.</div>;
  if (!change) return <div className="mt-4 rounded-md border border-emerald-900/50 bg-emerald-950/20 p-2 text-[10.5px] text-emerald-200">No semantic contract changes since snapshot {diff.baseSnapshotId}.</div>;
  const tone = change.compatibility === 'break' ? 'red' : change.compatibility === 'potential' ? 'orange' : change.compatibility === 'conditional' ? 'amber' : 'green';
  return <div className="mt-4"><div className="flex items-center gap-2"><Badge tone={tone}>{change.compatibility.toUpperCase()}</Badge><span className="font-mono text-[10px] text-zinc-500">snapshot {diff.baseSnapshotId} → {diff.headSnapshotId}</span></div><div className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Field changes</div>{change.fields.map((field) => <div key={`${field.kind}:${field.path}`} className="border-b border-zinc-800 py-2"><div className="flex items-center gap-2"><Badge tone={field.kind === 'removed' || field.compat === 'break' ? 'red' : field.kind === 'added' ? 'green' : 'amber'}>{field.kind}</Badge><span className="min-w-0 truncate font-mono text-[10px] text-zinc-300">{field.path}</span></div><div className="mt-1 text-[10px] text-zinc-500">{field.note}</div>{field.before && <div className="mt-1 truncate font-mono text-[9.5px] text-red-300">− {field.before}</div>}{field.after && <div className="truncate font-mono text-[9.5px] text-emerald-300">+ {field.after}</div>}</div>)}</div>;
}

function Stat({ icon: Icon, label, value, tone = 'text-zinc-50' }: { icon: ComponentType<{ className?: string }>; label: string; value: number; tone?: string }) {
  return <div className="rounded-md border border-zinc-800 bg-zinc-900/30 p-3"><Icon className="h-4 w-4 text-zinc-500" /><div className={cn('mt-3 font-mono text-[20px]', tone)}>{value}</div><div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div></div>;
}

function Overview({ openExplorer }: { openExplorer: () => void }) {
  const { snapshot, active, reindex, loading } = useProduct();
  if (!snapshot || !active) return null;
  const counts = Object.entries(snapshot.nodes.reduce<Record<string, number>>((all, node) => { all[node.kind] = (all[node.kind] ?? 0) + 1; return all }, {}));
  return <div className="h-full overflow-y-auto p-5"><div className="mx-auto max-w-[1200px]"><div className="flex items-end justify-between"><div><div className="font-mono text-[10px] text-zinc-500">{active.path} · {active.head?.slice(0, 12) || 'working tree'}</div><h1 className="text-[18px] font-semibold">{active.name}</h1></div><Btn onClick={() => void reindex()} disabled={loading}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Re-index</Btn></div>
    <div className="mt-5 grid grid-cols-4 gap-3"><Stat icon={Network} label="system nodes" value={snapshot.stats.nodes} /><Stat icon={GitBranch} label="relationships" value={snapshot.stats.edges} /><Stat icon={ShieldAlert} label="violations" value={snapshot.stats.violations} tone="text-amber-300" /><Stat icon={FileCode2} label="contracts" value={snapshot.stats.contracts} /></div>
    <div className="mt-4 rounded-md border border-zinc-800"><div className="flex items-center border-b border-zinc-800 px-3 py-2"><span className="text-[11px] font-semibold">Indexed system model</span><Btn size="xs" className="ml-auto" onClick={openExplorer}>Open explorer <ArrowRight className="h-3 w-3" /></Btn></div><div className="flex flex-wrap gap-x-5 gap-y-2 p-3">{counts.map(([kind, count]) => <div key={kind} className="font-mono text-[11px] text-zinc-400"><span className="text-zinc-100">{count}</span> {kind}</div>)}</div></div>
    <div className="mt-4 rounded-md border border-zinc-800"><div className="border-b border-zinc-800 px-3 py-2 text-[11px] font-semibold">Highest-priority deterministic findings</div>{snapshot.analysis.violations.slice(0, 10).map((violation) => <div key={violation.id} className="flex items-start gap-3 border-b border-zinc-800/60 px-3 py-2 last:border-0"><SeverityBadge severity={snapshot.analysis.rules.find((rule) => rule.id === violation.ruleId)?.severity ?? 'medium'} /><div><div className="text-[11.5px] text-zinc-200">{violation.title}</div><div className="mt-0.5 text-[10.5px] text-zinc-500">{violation.detail}</div></div></div>)}</div>
  </div></div>;
}

function RulesScreen() {
  const { snapshot } = useProduct();
  return <div className="h-full overflow-y-auto p-5"><h1 className="text-[16px] font-semibold">Deterministic graph rules</h1><p className="mt-1 text-[11px] text-zinc-500">Evaluated from the current persisted repository snapshot.</p><div className="mt-4 space-y-3">{snapshot?.analysis.rules.map((rule) => <div key={rule.id} className="rounded-md border border-zinc-800"><div className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2"><span className="font-mono text-[11px] text-sky-300">{rule.id}</span><span className="text-[12px] font-medium">{rule.title}</span><span className="ml-auto"><SeverityBadge severity={rule.severity} /></span></div><div className="p-3 text-[11px] text-zinc-400">{rule.description}<div className="mt-2 font-mono text-[10px] text-zinc-600">detects: {rule.detects}</div></div>{snapshot.analysis.violations.filter((item) => item.ruleId === rule.id).map((item) => <div key={item.id} className="border-t border-zinc-800 px-3 py-2 text-[11px] text-zinc-300">{item.title}</div>)}</div>)}</div></div>;
}

function SearchScreen() {
  const { snapshot } = useProduct(); const [query, setQuery] = useState('');
  const results = (snapshot?.nodes ?? []).filter((node) => query && `${node.label} ${node.file ?? ''} ${node.kind}`.toLowerCase().includes(query.toLowerCase())).slice(0, 100);
  return <div className="h-full overflow-y-auto p-5"><div className="flex h-10 max-w-[760px] items-center gap-2 rounded-md border border-zinc-700 bg-zinc-950 px-3"><Search className="h-4 w-4 text-zinc-500" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search indexed symbols and files" className="w-full bg-transparent text-[13px] outline-none" /></div><div className="mt-3 max-w-[900px]">{results.map((node) => <div key={node.id} className="flex items-center gap-2 border-b border-zinc-800 px-2 py-2"><KindIcon kind={node.kind} /><span className="font-mono text-[11px] text-zinc-200">{node.label}</span><span className="ml-auto font-mono text-[10px] text-zinc-600">{node.file}</span></div>)}</div></div>;
}

function SettingsScreen() {
  const { repositories, active, selectRepository, addRepository, loading } = useProduct(); const [path, setPath] = useState('');
  const { reindex } = useProduct(); const [coveragePath, setCoveragePath] = useState(''); const [telemetryPath, setTelemetryPath] = useState('');
  return <div className="h-full overflow-y-auto p-5"><h1 className="text-[16px] font-semibold">Repositories</h1><div className="mt-4 max-w-[800px] rounded-md border border-zinc-800">{repositories.map((repository) => <button key={repository.id} onClick={() => selectRepository(repository.id)} className={cn('flex w-full items-center gap-3 border-b border-zinc-800 px-3 py-3 text-left last:border-0', active?.id === repository.id && 'bg-sky-500/5')}><Database className="h-4 w-4 text-zinc-500" /><div><div className="text-[12px] text-zinc-200">{repository.name}</div><div className="font-mono text-[10px] text-zinc-600">{repository.path}</div></div><Badge className="ml-auto" tone={repository.status === 'ready' ? 'green' : repository.status === 'error' ? 'red' : 'neutral'}>{repository.status}</Badge></button>)}</div><form onSubmit={(event) => { event.preventDefault(); if (path.trim()) void addRepository(path.trim()).then(() => setPath('')) }} className="mt-4 flex max-w-[800px] gap-2"><input value={path} onChange={(event) => setPath(event.target.value)} placeholder="Add another local Git repository" className="h-8 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 font-mono text-[11px] outline-none" /><Btn variant="solid" disabled={loading || !path.trim()}><Plus className="h-3.5 w-3.5" /> Add and index</Btn></form><div className="mt-8 max-w-[800px]"><h2 className="text-[13px] font-semibold">Measured Go coverage</h2><p className="mt-1 text-[10.5px] text-zinc-500">Provide an absolute path or a repository-relative Go coverprofile. Re-indexing creates a new historical snapshot.</p><form onSubmit={(event) => { event.preventDefault(); if (coveragePath.trim()) void reindex(coveragePath.trim()) }} className="mt-2 flex gap-2"><input value={coveragePath} onChange={(event) => setCoveragePath(event.target.value)} placeholder="coverage.out" className="h-8 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 font-mono text-[11px] outline-none" /><Btn variant="solid" disabled={loading || !coveragePath.trim()}><RefreshCw className="h-3.5 w-3.5" /> Re-index with coverage</Btn></form></div><div className="mt-8 max-w-[800px]"><h2 className="text-[13px] font-semibold">Runtime telemetry</h2><p className="mt-1 text-[10.5px] text-zinc-500">Import a repository-relative or absolute JSON file containing measured metrics, source, and observation window.</p><form onSubmit={(event) => { event.preventDefault(); if (telemetryPath.trim()) void reindex(undefined, telemetryPath.trim()) }} className="mt-2 flex gap-2"><input value={telemetryPath} onChange={(event) => setTelemetryPath(event.target.value)} placeholder="aegir-telemetry.json" className="h-8 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 font-mono text-[11px] outline-none" /><Btn variant="solid" disabled={loading || !telemetryPath.trim()}><Activity className="h-3.5 w-3.5" /> Import and re-index</Btn></form></div></div>;
}

function DeltaDetails({ entry }: { entry: GraphNodeDelta | GraphEdgeDelta }) {
  return <div className="border-b border-zinc-800 p-3"><div className="flex items-center gap-2"><Badge tone={entry.status === 'added' ? 'green' : entry.status === 'removed' ? 'red' : 'blue'}>{entry.status.toUpperCase()}</Badge><span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Change reasons</span></div>{entry.changeReasons.map((reason, index) => <div key={`${reason.kind}:${index}`} className="mt-2"><div className="font-mono text-[10px] text-zinc-300">{reason.kind}</div><div className="mt-0.5 text-[10px] leading-relaxed text-zinc-500">{reason.detail}</div></div>)}</div>;
}

function ArchitectureEvolutionBar({ changes, loading, open }: { changes: ArchitectureEvolutionChange[]; loading: boolean; open: (change: ArchitectureEvolutionChange) => void }) {
  return <div className="flex min-h-9 items-center gap-2 overflow-x-auto border-b border-zinc-800 bg-fuchsia-950/10 px-3 py-1"><span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-fuchsia-400">Architecture evolution</span>{loading ? <span className="text-[9.5px] text-zinc-500">Comparing canonical snapshots…</span> : changes.length ? changes.slice(0, 5).map((change) => <button key={change.id} onClick={() => open(change)} title={change.question} className="shrink-0 rounded border border-fuchsia-900/60 px-2 py-1 text-[9px] text-fuchsia-200">{change.title}</button>) : <span className="text-[9.5px] text-zinc-500">No actionable structural changes in this review scope.</span>}</div>;
}

function ReviewScreen({ theme, focusMode, setFocusMode }: GraphViewProps) {
  const { active } = useProduct();
  const { state: investigation, dispatch } = useInvestigation();
  const selected = investigation.focalNodeId;
  const { upstream: upstreamDepth, downstream: downstreamDepth } = investigation.depth;
  const enabledRelationships = useMemo(
    () => deriveEnabledRelationships(investigation, MODE_RELATIONSHIPS.impact),
    [investigation],
  );
  const branchExpansions = useMemo(() => legacyBranchExpansions(investigation), [investigation]);
  const [baseRef, setBaseRef] = useState('main');
  const [headRef, setHeadRef] = useState('WORKTREE');
  const [review, setReview] = useState<LocalReview>();
  const [reviewSnapshots, setReviewSnapshots] = useState<{ base?: ProductSnapshot; head?: ProductSnapshot }>({});
  const [reviewPolicy, setReviewPolicy] = useState<ReviewGraphPolicy>('changes-impact');
  const [reviewSnapshotSide, setReviewSnapshotSide] = useState<'base' | 'delta' | 'head'>('delta');
  const delta = useMemo(() => review ? adaptGraphDelta(review) : { nodes: [], edges: [] }, [review]);
  const policyGraph = useMemo(() => review ? reviewSnapshotSide === 'delta' ? graphForReviewPolicy(review, delta, reviewPolicy) : graphForReviewSnapshot(review, delta, reviewSnapshotSide) : { nodes: [], edges: [] }, [review, delta, reviewPolicy, reviewSnapshotSide]);
  const canonicalReviewIndex = useMemo(() => createGraphIndex(policyGraph.nodes, policyGraph.edges, review?.evidence ?? []), [policyGraph, review?.evidence]);
  const reviewAbstractionGraph = useMemo(() => abstractGraph(canonicalReviewIndex, investigation.abstraction), [canonicalReviewIndex, investigation.abstraction]);
  const reviewIndex = reviewAbstractionGraph.index;
  const reviewProjectedSelected = selected ? reviewAbstractionGraph.canonicalToRepresentative.get(selected) : undefined;
  const reviewProjectedPins = useMemo(() => [...new Set(investigation.pinnedNodeIds.flatMap((id) => reviewAbstractionGraph.canonicalToRepresentative.get(id) ?? []))], [investigation.pinnedNodeIds, reviewAbstractionGraph]);
  useEffect(() => {
    setReviewSnapshots({});
    if (!active || !review?.baseSnapshotId || !review.headSnapshotId) return;
    let current = true;
    Promise.all([
      fetch(`/api/repositories/${active.id}/graph?snapshot=${review.baseSnapshotId}`).then((response) => response.ok ? response.json() as Promise<ProductSnapshot> : Promise.reject(new Error('Base snapshot unavailable.'))),
      fetch(`/api/repositories/${active.id}/graph?snapshot=${review.headSnapshotId}`).then((response) => response.ok ? response.json() as Promise<ProductSnapshot> : Promise.reject(new Error('Head snapshot unavailable.'))),
    ]).then(([base, head]) => { if (current) setReviewSnapshots({ base, head }) }).catch(() => { if (current) setReviewSnapshots({}) });
    return () => { current = false };
  }, [active?.id, review?.baseSnapshotId, review?.headSnapshotId]);
  const architectureEvolution = useMemo(() => {
    if (!active || !reviewSnapshots.base || !reviewSnapshots.head) return { version: 1 as const, comparable: false, warnings: [], changes: [] };
    const analytics = (snapshot: ProductSnapshot) => {
      const canonical = createGraphIndex(snapshot.nodes, snapshot.edges, snapshot.evidence);
      const abstracted = abstractGraph(canonical, investigation.abstraction).index;
      return computeStructuralAnalytics({ repositoryId: active.id, snapshotId: snapshot.id, abstraction: investigation.abstraction, nodes: abstracted.nodes, edges: abstracted.edges });
    };
    return analyzeArchitectureEvolution({ delta, base: analytics(reviewSnapshots.base), head: analytics(reviewSnapshots.head) });
  }, [active, reviewSnapshots, investigation.abstraction, delta]);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    setReview(undefined);
    if (!active) return;
    let current = true;
    fetch(`/api/repositories/${active.id}/reviews/latest`)
      .then((response) => response.ok ? response.json() : undefined)
      .then((value) => { if (current && value) setReview(value) });
    return () => { current = false };
  }, [active?.id]);
  useEffect(() => {
    if (review) dispatch({ type: 'resetContext', contextKey: `review:${active?.id ?? 'none'}:${review.id}`, projectionId: 'impact' });
  }, [active?.id, review?.id, dispatch]);
  const run = async () => {
    if (!active) return;
    setLoading(true); setError(undefined);
    try {
      const response = await fetch(`/api/repositories/${active.id}/reviews`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ baseRef, headRef }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Review failed');
      setReview(body);
      dispatch({ type: 'setProjection', projectionId: 'impact' });
      dispatch({ type: 'setFocalNode', nodeId: undefined });
      dispatch({ type: 'clearRelationshipOverrides' });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setLoading(false) }
  };
  const graph = projectPRGraphIndex(reviewIndex, { projectionId: 'review', activeNodeId: reviewPolicy === 'blast-radius' ? reviewProjectedSelected : undefined, upstreamDepth, downstreamDepth, edgeKinds: enabledRelationships, branchExpansions, nodeBudget: 30, evidencePolicy: investigation.evidencePolicy, pinnedNodeIds: reviewProjectedPins });
  const selectedEdgeId = investigation.selectedEntity?.kind === 'edge' ? investigation.selectedEntity.id : undefined;
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedVisibleEdge = graph.visibleGraph.edges.find((edge) => edge.kind === 'real' && edge.id === selectedEdgeId);
  const selectedNodeDelta = reviewSnapshotSide === 'delta' ? delta.nodes.find((entry) => entry.id === selected || (reviewProjectedSelected ? reviewAbstractionGraph.representativeNodeMembers.get(reviewProjectedSelected)?.includes(entry.id) : false)) : undefined;
  const selectedEdgeDelta = reviewSnapshotSide === 'delta' ? delta.edges.find((entry) => entry.id === selectedEdgeId || (selectedEdgeId ? reviewAbstractionGraph.representativeEdgeMembers.get(selectedEdgeId)?.includes(entry.id) : false)) : undefined;
  useEffect(() => {
    if (selectedEdgeId && !selectedEdge) dispatch({ type: 'selectEntity', entity: selected ? { kind: 'node', id: selected } : null });
  }, [selectedEdgeId, selectedEdge, selected, dispatch]);
  useEffect(() => {
    if (!review || !selected || review.nodes.some((node) => node.id === selected)) return;
    dispatch({ type: 'reconcileFocalNode', nodeId: reconcileMissingFocal(investigation, new Set(review.nodes.map((node) => node.id)), graph.visibleGraph.rootNodeIds[0] ?? review.nodes[0]?.id) });
  }, [review, selected, investigation, graph.visibleGraph.rootNodeIds, dispatch]);
  if (!review) return <div className="flex h-full items-center justify-center p-6"><div className="w-full max-w-[580px] rounded-lg border border-zinc-800 bg-zinc-900/30 p-5"><GitCompare className="h-6 w-6 text-violet-300" /><h1 className="mt-3 text-[16px] font-semibold">Review local Git changes</h1><p className="mt-1 text-[11px] text-zinc-500">Aegir archives the base ref read-only, compares it with another ref or the current working tree, and persists an evidence-backed graph review.</p><ReviewForm baseRef={baseRef} headRef={headRef} setBaseRef={setBaseRef} setHeadRef={setHeadRef} run={run} loading={loading} /><>{error && <div className="mt-3 text-[11px] text-red-300">{error}</div>}</></div></div>;
  const statusMaps = reviewSnapshotSide === 'delta' ? deltaStatusMaps(delta) : { nodes: new Map<string, import('../data/types').GraphDeltaStatus>(), edges: new Map<string, import('../data/types').GraphDeltaStatus>() };
  const decor: GraphDecor = { tone: {}, badges: {}, edgeTone: {}, edgeLabel: {}, dimmed: new Set(), edgeDimmed: new Set() };
  for (const node of graph.nodes) {
    const statuses = (reviewAbstractionGraph.representativeNodeMembers.get(node.id) ?? [node.id]).flatMap((id) => statusMaps.nodes.get(id) ?? []);
    const status = statuses.includes('added') ? 'added' : statuses.includes('removed') ? 'removed' : statuses.includes('modified') ? 'modified' : undefined;
    if (status) { decor.tone![node.id] = status; decor.badges![node.id] = [{ text: status.toUpperCase(), tone: status === 'added' ? 'green' : status === 'removed' ? 'red' : 'blue' }] }
  }
  for (const edge of graph.edges) {
    const statuses = (reviewAbstractionGraph.representativeEdgeMembers.get(edge.id) ?? [edge.id]).flatMap((id) => statusMaps.edges.get(id) ?? []);
    const status = statuses.includes('added') ? 'added' : statuses.includes('removed') ? 'removed' : statuses.includes('modified') ? 'modified' : undefined;
    if (status) { decor.edgeTone![edge.id] = status === 'modified' ? 'highlight' : status; decor.edgeLabel![edge.id] = status.toUpperCase() }
  }
  if (reviewPolicy === 'changes-impact') {
    for (const node of graph.nodes) if (!(reviewAbstractionGraph.representativeNodeMembers.get(node.id) ?? [node.id]).some((id) => statusMaps.nodes.has(id))) decor.dimmed!.add(node.id);
    for (const edge of graph.edges) if (!(reviewAbstractionGraph.representativeEdgeMembers.get(edge.id) ?? [edge.id]).some((id) => statusMaps.edges.has(id))) decor.edgeDimmed!.add(edge.id);
  }
  const selectGraphNode = (id: string) => {
    const aggregate = graph.aggregates.find((item) => item.nodeId === id);
    if (aggregate) {
      dispatch({ type: 'expandFrontier', frontierId: aggregate.branchKey, beyondDepth: !aggregate.withinDepth });
      return;
    }
    dispatch({ type: 'setFocalNode', nodeId: id });
  };
  const toggleRelationship = (kind: EdgeKind) => dispatch({ type: 'setRelationshipOverride', kind, value: enabledRelationships.has(kind) ? 'exclude' : 'include' });
  return (
    <div className="flex h-full min-h-0 flex-col">
      {!focusMode && <header className="border-b border-zinc-800 px-4 py-3">
        <div className="flex items-start gap-3">
          <GitPullRequest className="mt-0.5 h-5 w-5 text-violet-300" />
          <div><h1 className="text-[14px] font-semibold">{review.baseRef} <span className="text-zinc-600">→</span> {review.headRef}</h1><div className="mt-1 font-mono text-[10px] text-zinc-500">review {review.id} · {new Date(review.createdAt).toLocaleString()}</div></div>
          <div className="ml-3 flex rounded-md border border-zinc-800 p-0.5">{([['changes-only', 'Changes only'], ['changes-impact', 'Changes + impact'], ['blast-radius', 'Blast radius']] as const).map(([value, label]) => <button key={value} onClick={() => setReviewPolicy(value)} className={cn('rounded px-2 py-1 text-[10px]', reviewPolicy === value ? 'bg-violet-500/15 text-violet-200' : 'text-zinc-500 hover:text-zinc-200')}>{label}</button>)}</div>
          <div className="flex rounded-md border border-zinc-800 p-0.5">{([['base', 'Base'], ['delta', 'Δ'], ['head', 'Head']] as const).map(([value, label]) => <button key={value} onClick={() => setReviewSnapshotSide(value)} className={cn('rounded px-2 py-1 text-[10px]', reviewSnapshotSide === value ? 'bg-sky-500/15 text-sky-200' : 'text-zinc-500 hover:text-zinc-200')}>{label}</button>)}</div>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => setInspectorOpen((value) => !value)} aria-label={inspectorOpen ? 'Hide review sidebar' : 'Show review sidebar'} title={inspectorOpen ? 'Hide review sidebar' : 'Show review sidebar'} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">{inspectorOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}</button>
            <button onClick={() => setFocusMode(true)} aria-label="Enter focus mode" title="Focus mode" className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><Maximize2 className="h-3.5 w-3.5" /></button>
            <ReviewForm compact baseRef={baseRef} headRef={headRef} setBaseRef={setBaseRef} setHeadRef={setHeadRef} run={run} loading={loading} />
          </div>
        </div>
        <div className="mt-3 flex gap-5 font-mono text-[10px] text-zinc-400"><span className="text-emerald-300">+{review.summary.addedNodes} nodes</span><span className="text-red-300">−{review.summary.removedNodes} nodes</span><span>{review.summary.modifiedNodes} modified</span><span>{review.summary.addedEdges} added edges</span><span>{review.summary.newViolations} new violations</span><span>{review.contractDiff.changes.length} contract changes</span><span>{graph.nodes.length} visible</span></div>
        {error && <div className="mt-2 text-[11px] text-red-300">{error}</div>}
      </header>}
      {!focusMode && <InvestigationBreadcrumbs nodes={review.nodes} />}
      {!focusMode && <ArchitectureEvolutionBar changes={architectureEvolution.changes} loading={!reviewSnapshots.base || !reviewSnapshots.head} open={(change) => { setReviewSnapshotSide('delta'); setReviewPolicy('changes-impact'); if (change.edgeIds[0]) dispatch({ type: 'selectEntity', entity: { kind: 'edge', id: change.edgeIds[0] } }); else if (change.nodeIds[0]) dispatch({ type: 'setFocalNode', nodeId: change.nodeIds[0] }) }} />}
      {!focusMode && <PinnedStrip nodeIds={investigation.pinnedNodeIds} nodes={review.nodes} unpin={(nodeId) => dispatch({ type: 'unpinNode', nodeId })} clear={() => dispatch({ type: 'clearPins' })} />}
      {!focusMode && <GraphScopeControls upstream={upstreamDepth} downstream={downstreamDepth} setUpstream={(depth) => dispatch({ type: 'setDepth', direction: 'upstream', depth })} setDownstream={(depth) => dispatch({ type: 'setDepth', direction: 'downstream', depth })} relationships={MODE_RELATIONSHIPS.impact} enabledRelationships={enabledRelationships} toggleRelationship={toggleRelationship} evidenceLevel={investigation.evidencePolicy.maximumLevel} includeStale={investigation.evidencePolicy.includeStale} setEvidenceLevel={(maximumLevel) => dispatch({ type: 'setEvidencePolicy', maximumLevel })} setIncludeStale={(includeStale) => dispatch({ type: 'setEvidencePolicy', includeStale })} abstraction={investigation.abstraction} setAbstraction={(abstraction) => dispatch({ type: 'setAbstraction', abstraction })} expandedBranches={expandedBranchLabels(branchExpansions, review.nodes)} collapseBranch={(key) => dispatch({ type: 'collapseFrontier', frontierId: key })} />}
      <div className={cn('grid min-h-0 flex-1', !focusMode && inspectorOpen ? 'grid-cols-[1fr_360px]' : 'grid-cols-1')}>
        <div className="relative min-w-0"><SystemGraph nodes={graph.nodes} edges={graph.edges} frontiers={graph.aggregates} decor={decor} selected={reviewProjectedSelected} selectedEdge={selectedEdgeId} onSelect={selectGraphNode} onEdgeSelect={(id) => dispatch({ type: 'selectEntity', entity: { kind: 'edge', id } })} onDoubleClick={selectGraphNode} anchorNodeId={reviewProjectedSelected ?? graph.visibleGraph.rootNodeIds[0]} pinnedNodeIds={reviewProjectedPins} topologyRevision={graph.visibleGraph.revision} layoutStrategy="review-LR" minimap theme={theme} />{focusMode && <button onClick={() => setFocusMode(false)} aria-label="Exit focus mode" className="absolute right-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950/90 px-2.5 py-1.5 text-[11px] text-zinc-300 shadow-lg hover:bg-zinc-800"><Minimize2 className="h-3.5 w-3.5" /> Exit focus</button>}</div>
        {!focusMode && inspectorOpen && <aside className="overflow-y-auto border-l border-zinc-800">{selectedEdge ? <>{selectedEdgeDelta && <DeltaDetails entry={selectedEdgeDelta} />}<div className="p-3"><EdgeInspector edge={selectedEdge} nodes={[...reviewIndex.nodes]} evidence={evidenceForEdge(reviewIndex, selectedEdge)} reason={selectedVisibleEdge?.reason.detail} onSelectNode={(id) => dispatch({ type: 'setFocalNode', nodeId: id })} /></div></> : selectedNodeDelta ? <DeltaDetails entry={selectedNodeDelta} /> : <><div className="border-b border-zinc-800 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Review findings</div>{review.newViolations.map((violation) => <div key={violation.id} className="border-b border-zinc-800 p-3"><div className="flex items-center gap-2"><Badge tone="red">NEW</Badge><span className="font-mono text-[10px] text-zinc-500">{violation.ruleId}</span></div><div className="mt-1 text-[11px] text-zinc-200">{violation.title}</div><div className="mt-1 text-[10px] text-zinc-500">{violation.detail}</div></div>)}{review.contractDiff.changes.map((change) => <div key={change.contractId} className="border-b border-zinc-800 p-3"><div className="flex items-center gap-2"><Badge tone={change.compatibility === 'break' ? 'red' : change.compatibility === 'potential' ? 'orange' : 'green'}>{change.compatibility.toUpperCase()}</Badge><span className="text-[11px] text-zinc-200">{change.name}</span></div><div className="mt-1 text-[10px] text-zinc-500">{change.fields.length} semantic field changes</div></div>)}{review.newViolations.length === 0 && review.contractDiff.changes.length === 0 && <div className="p-4 text-[11px] text-zinc-500">No new deterministic findings or contract changes.</div>}</>}</aside>}
      </div>
    </div>
  );
}

function ReviewForm({ baseRef, headRef, setBaseRef, setHeadRef, run, loading, compact = false }: { baseRef: string; headRef: string; setBaseRef: (value: string) => void; setHeadRef: (value: string) => void; run: () => void; loading: boolean; compact?: boolean }) {
  return <div className={cn('flex gap-2', !compact && 'mt-4')}><input value={baseRef} onChange={(event) => setBaseRef(event.target.value)} placeholder="base ref" className="h-8 w-[150px] rounded-md border border-zinc-700 bg-zinc-950 px-2 font-mono text-[10px] outline-none" /><input value={headRef} onChange={(event) => setHeadRef(event.target.value)} placeholder="HEAD or WORKTREE" className="h-8 w-[150px] rounded-md border border-zinc-700 bg-zinc-950 px-2 font-mono text-[10px] outline-none" /><Btn variant="solid" onClick={run} disabled={loading || !baseRef.trim()}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompare className="h-3.5 w-3.5" />} Analyze</Btn></div>;
}

function AbstractionShortcutController({ enabled }: { enabled: boolean }) {
  const { dispatch } = useInvestigation();
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let timer = 0;
    const handle = (event: KeyboardEvent) => {
      const shortcut = abstractionShortcutForEvent({ key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, target: event.target as ShortcutEventLike['target'] });
      if (!shortcut) return;
      event.preventDefault();
      dispatch({ type: 'setAbstraction', abstraction: shortcut.level });
      setPreview(`${event.key} · ${shortcut.label} — ${shortcut.description}`);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setPreview(''), 1800);
    };
    window.addEventListener('keydown', handle);
    return () => { window.removeEventListener('keydown', handle); window.clearTimeout(timer) };
  }, [enabled, dispatch]);
  return preview ? <div role="status" className="fixed right-4 top-4 z-[100] rounded-md border border-sky-800 bg-zinc-950/95 px-3 py-2 text-[10px] text-sky-200 shadow-xl">Prototype semantic zoom · {preview}</div> : null;
}

export function ProductApp() {
  const { repositories, active, snapshot, loading, error, selectRepository } = useProduct();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => window.localStorage.getItem('aegir-theme') === 'light' ? 'light' : 'dark');
  const [screen, setScreen] = useState<Screen>('overview');
  const [railOpen, setRailOpen] = useState(true);
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
    window.localStorage.setItem('aegir-theme', theme);
  }, [theme]);
  if (!loading && repositories.length === 0) return <Onboarding />;
  const graphViewProps: GraphViewProps = { theme, focusMode, setFocusMode };
  return (
    <div className="flex h-full bg-zinc-950 text-zinc-200">
      <AbstractionShortcutController enabled={screen === 'explorer' || screen === 'pulls'} />
      {railOpen && !focusMode && <aside className="flex w-[190px] shrink-0 flex-col border-r border-zinc-800">
        <div className="flex h-12 items-center gap-2 border-b border-zinc-800 px-3">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-sky-500/15"><Activity className="h-4 w-4 text-sky-300" /></div>
          <span className="text-[13px] font-semibold">Aegir</span>
          <Badge className="ml-auto">LOCAL</Badge>
          <button onClick={() => setRailOpen(false)} aria-label="Hide navigation rail" title="Hide navigation rail" className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><PanelLeftClose className="h-3.5 w-3.5" /></button>
        </div>
        <div className="border-b border-zinc-800 p-2"><select value={active?.id ?? ''} onChange={(event) => selectRepository(event.target.value)} className="h-8 w-full rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-[10px]">{repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}</select></div>
        <nav className="p-2">{NAV.map(([id, label, Icon]) => <button key={id} onClick={() => setScreen(id)} className={cn('mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11.5px]', screen === id ? 'bg-zinc-800 text-zinc-50' : 'text-zinc-400 hover:bg-zinc-900')}><Icon className="h-3.5 w-3.5" />{label}</button>)}</nav>
        <div className="mt-auto border-t border-zinc-800 p-2"><button onClick={() => setTheme((value) => value === 'dark' ? 'light' : 'dark')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[11px] text-zinc-500 hover:bg-zinc-900">{theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}{theme === 'dark' ? 'Light' : 'Dark'} theme</button></div>
      </aside>}
      <div className="relative min-w-0 flex-1">
        {!railOpen && !focusMode && <button onClick={() => setRailOpen(true)} aria-label="Show navigation rail" title="Show navigation rail" className="absolute bottom-3 left-3 z-50 rounded-md border border-zinc-700 bg-zinc-950/90 p-2 text-zinc-400 shadow-lg hover:bg-zinc-800 hover:text-zinc-100"><PanelLeftOpen className="h-4 w-4" /></button>}
        {loading && !snapshot ? <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-sky-300" /></div> : error ? <div className="p-5 text-red-300">{error}</div> : screen === 'overview' ? <Overview openExplorer={() => setScreen('explorer')} /> : screen === 'explorer' ? <Explorer {...graphViewProps} /> : screen === 'rules' ? <RulesScreen /> : screen === 'search' ? <SearchScreen /> : screen === 'settings' ? <SettingsScreen /> : <ReviewScreen {...graphViewProps} />}
      </div>
    </div>
  );
}
