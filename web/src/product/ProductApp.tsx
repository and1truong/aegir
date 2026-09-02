import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  Activity, AlertTriangle, ArrowRight, Database, FileCode2, GitBranch, GitCompare, GitPullRequest,
  LayoutDashboard, Loader2, Maximize2, Minimize2, Moon, Network, PanelLeftClose, PanelLeftOpen,
  PanelRightClose, PanelRightOpen, Plus, RefreshCw, Search, Settings, ShieldAlert, Sun,
} from 'lucide-react';
import type { EdgeKind, EvidenceRecord, SysEdge, SysNode } from '../data/types';
import { SystemGraph, type GraphDecor } from '../components/graph/SystemGraph';
import { Badge, Btn, KindIcon, SeverityBadge } from './ui';
import { cn } from '../utils/cn';
import { useProduct } from './ProductContext';
import { GraphScopeControls, type ExpandedBranch } from './GraphScopeControls';
import { projectGraphIndex, projectPRGraphIndex, type BranchExpansions } from '../lib/graphProjection';
import { useInvestigation } from '../investigation/InvestigationContext';
import { enabledRelationships as deriveEnabledRelationships, legacyBranchExpansions } from '../investigation/reducer';
import { createGraphIndex } from '../graph/index';
import { evidenceForEdge, formatEvidenceLocation } from '../graph/evidence';
import { projectionDefinitions, questionProjectionIds, signalProjectionIds } from '../graph/projection/definitions';

type Screen = 'overview' | 'explorer' | 'pulls' | 'rules' | 'search' | 'settings';
type ExplorerMode = 'dependencies' | 'data flow' | 'runtime' | 'impact' | 'coverage' | 'complexity' | 'contracts' | 'lint' | 'what-can-break' | 'hot-path' | 'state-mutation' | 'retry-paths' | 'transaction-boundaries' | 'cross-team-dependencies' | 'what-changed-architecturally';

interface ContractDiff {
  baseSnapshotId: number;
  headSnapshotId: number;
  changes: { contractId: string; name: string; type: string; status: string; compatibility: 'safe' | 'conditional' | 'potential' | 'break'; fields: { kind: string; path: string; before?: string; after?: string; compat: 'safe' | 'conditional' | 'potential' | 'break'; note: string }[] }[];
}

interface LocalReview {
  id: string;
  baseRef: string;
  headRef: string;
  createdAt: string;
  summary: { addedNodes: number; removedNodes: number; modifiedNodes: number; addedEdges: number; removedEdges: number; newViolations: number; resolvedViolations: number };
  nodes: SysNode[];
  edges: SysEdge[];
  evidence?: EvidenceRecord[];
  newViolations: { id: string; ruleId: string; title: string; detail: string }[];
  resolvedViolations: { id: string; ruleId: string; title: string; detail: string }[];
  contractDiff: ContractDiff;
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
    const [direction, encodedParentId] = key.split(':');
    const parentId = decodeURIComponent(encodedParentId);
    return { key, direction: direction as ExpandedBranch['direction'], label: labels.get(parentId) ?? 'branch' };
  });
}

interface GraphViewProps {
  theme: 'light' | 'dark';
  focusMode: boolean;
  setFocusMode: (value: boolean) => void;
  railOpen: boolean;
}

function Explorer({ theme, focusMode, setFocusMode, railOpen }: GraphViewProps) {
  const { active, snapshot } = useProduct();
  const { state: investigation, dispatch } = useInvestigation();
  const mode = investigation.projectionId as ExplorerMode;
  const selected = investigation.focalNodeId;
  const { upstream: upstreamDepth, downstream: downstreamDepth } = investigation.depth;
  const enabledRelationships = useMemo(
    () => deriveEnabledRelationships(investigation, MODE_RELATIONSHIPS[mode]),
    [investigation, mode],
  );
  const branchExpansions = useMemo(() => legacyBranchExpansions(investigation), [investigation]);
  const [query, setQuery] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [contractDiff, setContractDiff] = useState<ContractDiff>();
  const nodes = snapshot?.nodes ?? [];
  const edges = snapshot?.edges ?? [];
  const graphIndex = useMemo(() => createGraphIndex(nodes, edges, snapshot?.evidence ?? [], {
    telemetry: snapshot?.analysis.telemetry,
    findingNodeIds: snapshot?.analysis.violations.flatMap((violation) => violation.path.length ? violation.path : [violation.primaryNode]),
  }), [nodes, edges, snapshot?.evidence, snapshot?.analysis.telemetry, snapshot?.analysis.violations]);

  useEffect(() => {
    dispatch({ type: 'resetContext', contextKey: `snapshot:${active?.id ?? 'none'}:${snapshot?.id ?? 'none'}`, projectionId: 'dependencies' });
    setContractDiff(undefined);
  }, [active?.id, snapshot?.id, dispatch]);
  useEffect(() => {
    if (selected && !nodes.some((node) => node.id === selected)) dispatch({ type: 'setFocalNode', nodeId: undefined });
  }, [nodes, selected, dispatch]);
  useEffect(() => {
    if (mode !== 'contracts' || !active) return;
    fetch(`/api/repositories/${active.id}/contracts/diff`).then((response) => response.json()).then(setContractDiff);
  }, [mode, active, snapshot?.id]);

  const violations = snapshot?.analysis.violations ?? [];
  const lintRoots = mode === 'lint' && !selected ? [...new Set(violations.flatMap((violation) => violation.path.length ? violation.path : [violation.primaryNode]))] : undefined;
  const graph = useMemo(() => projectGraphIndex(graphIndex, {
    projectionId: mode,
    activeNodeId: selected,
    rootNodeIds: lintRoots,
    upstreamDepth,
    downstreamDepth,
    edgeKinds: enabledRelationships,
    branchExpansions,
    nodeBudget: 30,
  }), [graphIndex, mode, selected, lintRoots, upstreamDepth, downstreamDepth, enabledRelationships, branchExpansions]);
  const selectedEdgeId = investigation.selectedEntity?.kind === 'edge' ? investigation.selectedEntity.id : undefined;
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedVisibleEdge = graph.visibleGraph.edges.find((edge) => edge.kind === 'real' && edge.id === selectedEdgeId);
  const selectedVisibleNode = graph.visibleGraph.nodes.find((item) => item.kind === 'real' && item.id === selected);
  useEffect(() => {
    if (selectedEdgeId && !selectedEdge) dispatch({ type: 'selectEntity', entity: selected ? { kind: 'node', id: selected } : null });
  }, [selectedEdgeId, selectedEdge, selected, dispatch]);
  const coverage = useMemo(() => new Map(snapshot?.analysis.coverage.map((item) => [item.nodeId, item]) ?? []), [snapshot]);
  const complexity = useMemo(() => new Map((snapshot?.analysis.complexity ?? []).map((item) => [item.nodeId, item])), [snapshot]);
  const telemetry = useMemo(() => new Map((snapshot?.analysis.telemetry ?? []).map((item) => [item.nodeId, item])), [snapshot]);
  const decor = useMemo<GraphDecor>(() => {
    const value: GraphDecor = { tone: {}, badges: {}, sub: {}, markers: {}, heat: {}, metrics: {} };
    if (selected) value.dimmed = new Set([...graph.retainedContext].filter((id) => id !== selected));
    for (const node of graph.nodes) {
      if (node.file) value.sub![node.id] = node.file;
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
    return value;
  }, [graph.nodes, graph.edges, graph.visibleGraph.nodes, mode, coverage, complexity, telemetry, violations, snapshot, contractDiff]);

  const selectedNode = nodes.find((node) => node.id === selected);
  const modeNodes = mode === 'contracts' ? nodes.filter((node) => node.kind === 'contract') : mode === 'lint' ? nodes.filter((node) => violations.some((violation) => violation.primaryNode === node.id || violation.path.includes(node.id))) : nodes;
  const filtered = modeNodes.filter((node) => !query || `${node.label} ${node.file ?? ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 300);
  const selectGraphNode = (id: string) => {
    const aggregate = graph.aggregates.find((item) => item.nodeId === id);
    if (aggregate) {
      dispatch({ type: 'expandFrontier', frontierId: aggregate.branchKey });
      return;
    }
    dispatch({ type: 'setFocalNode', nodeId: id });
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
        <span className="ml-auto font-mono text-[10px] text-zinc-500">{graph.nodes.length} nodes · {graph.edges.length} edges</span>
        <button onClick={() => setInspectorOpen((value) => !value)} aria-label={inspectorOpen ? 'Hide inspector' : 'Show inspector'} title={inspectorOpen ? 'Hide inspector' : 'Show inspector'} className="ml-1 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">{inspectorOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}</button>
        <button onClick={() => setFocusMode(true)} aria-label="Enter focus mode" title="Focus mode" className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><Maximize2 className="h-3.5 w-3.5" /></button>
      </div>}
      {!focusMode && projectionDefinitions[mode]?.category === 'question' && <div className="flex items-center gap-3 border-b border-zinc-800 bg-sky-950/10 px-3 py-1.5 text-[10.5px]"><span className="font-semibold text-sky-200">{projectionDefinitions[mode].label}</span><span className="text-zinc-500">{projectionDefinitions[mode].description}</span>{graph.visibleGraph.warnings.map((warning) => <span key={`${warning.code}:${warning.message}`} className="ml-auto text-amber-300">{warning.message}</span>)}</div>}
      {!focusMode && <GraphScopeControls upstream={upstreamDepth} downstream={downstreamDepth} setUpstream={(depth) => dispatch({ type: 'setDepth', direction: 'upstream', depth })} setDownstream={(depth) => dispatch({ type: 'setDepth', direction: 'downstream', depth })} relationships={MODE_RELATIONSHIPS[mode]} enabledRelationships={enabledRelationships} toggleRelationship={toggleRelationship} expandedBranches={expandedBranchLabels(branchExpansions, nodes)} collapseBranch={(key) => dispatch({ type: 'collapseFrontier', frontierId: key })} />}
      <div className="flex min-h-0 flex-1">
        {!focusMode && <aside className="flex w-[250px] shrink-0 flex-col border-r border-zinc-800">
          <div className="border-b border-zinc-800 p-2"><div className="flex h-7 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2"><Search className="h-3.5 w-3.5 text-zinc-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter symbols…" className="w-full bg-transparent font-mono text-[11px] outline-none" /></div></div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">{filtered.map((node) => <button key={node.id} onClick={() => dispatch({ type: 'setFocalNode', nodeId: node.id })} className={cn('flex w-full items-center gap-2 px-2 py-1 text-left', selected === node.id ? 'bg-sky-500/10 text-sky-100' : 'text-zinc-300 hover:bg-zinc-900')}><KindIcon kind={node.kind} /><span className="min-w-0 flex-1 truncate font-mono text-[10.5px]">{node.label}</span></button>)}</div>
        </aside>}
        <main className="relative min-w-0 flex-1"><SystemGraph nodes={graph.nodes} edges={graph.edges} frontiers={graph.aggregates} decor={decor} selected={selected} selectedEdge={selectedEdgeId} onSelect={selectGraphNode} onEdgeSelect={(id) => dispatch({ type: 'selectEntity', entity: { kind: 'edge', id } })} onDoubleClick={selectGraphNode} fitKey={`${mode}:${focusMode}:${inspectorOpen}:${railOpen}`} minimap theme={theme} />{focusMode && <button onClick={() => setFocusMode(false)} aria-label="Exit focus mode" className="absolute right-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950/90 px-2.5 py-1.5 text-[11px] text-zinc-300 shadow-lg hover:bg-zinc-800"><Minimize2 className="h-3.5 w-3.5" /> Exit focus</button>}</main>
        {!focusMode && inspectorOpen && <aside className="w-[310px] shrink-0 overflow-y-auto border-l border-zinc-800 p-3">
          {selectedEdge ? <EdgeInspector edge={selectedEdge} nodes={nodes} evidence={evidenceForEdge(graphIndex, selectedEdge)} reason={selectedVisibleEdge?.reason.detail} onSelectNode={(id) => dispatch({ type: 'setFocalNode', nodeId: id })} /> : selectedNode ? <><div className="flex items-center gap-2"><KindIcon kind={selectedNode.kind} /><Badge>{selectedNode.kind}</Badge></div><h2 className="mt-2 break-words font-mono text-[13px] text-zinc-50">{selectedNode.label}</h2><div className="mt-1 break-all font-mono text-[10px] text-zinc-500">{selectedNode.file}</div>{selectedVisibleNode?.kind === 'real' && <RankInspector score={selectedVisibleNode.score} />}{mode === 'coverage' && coverage.get(selectedNode.id) && <div className="mt-4 rounded-md border border-zinc-800 p-2"><div className="font-mono text-[18px] text-zinc-100">{coverage.get(selectedNode.id)?.line ?? '—'}%</div><div className="mt-1 text-[10px] text-zinc-500">{coverage.get(selectedNode.id)?.note}</div></div>}{mode === 'complexity' && complexity.get(selectedNode.id) && <ComplexityInspector item={complexity.get(selectedNode.id)!} />}{mode === 'runtime' && telemetry.get(selectedNode.id) && <RuntimeInspector item={telemetry.get(selectedNode.id)!} />}{mode === 'contracts' ? <ContractInspector diff={contractDiff} contractID={selectedNode.id} /> : <div className="mt-4 border-t border-zinc-800 pt-3"><div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Relationships in scope</div>{graph.edges.filter((edge) => edge.source === selected || edge.target === selected).slice(0, 30).map((edge) => { const other = nodes.find((node) => node.id === (edge.source === selected ? edge.target : edge.source)); return <button key={edge.id} onClick={() => other && dispatch({ type: 'setFocalNode', nodeId: other.id })} className="mt-1 flex w-full items-center gap-2 text-left text-[10.5px] text-zinc-300 hover:text-sky-200"><Badge>{edge.kind}</Badge><span className="truncate font-mono">{other?.label}</span></button> })}</div>}</> : <div className="text-zinc-500">Select a node or edge.</div>}
        </aside>}
      </div>
    </div>
  );
}

function EdgeInspector({ edge, nodes, evidence, reason, onSelectNode }: { edge: SysEdge; nodes: SysNode[]; evidence: EvidenceRecord[]; reason?: string; onSelectNode: (id: string) => void }) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  return <div><div className="flex items-center gap-2"><Badge tone="blue">{edge.kind}</Badge>{edge.boundary && <Badge>{edge.boundary}</Badge>}{edge.sync !== undefined && <Badge>{edge.sync ? 'sync' : 'async'}</Badge>}</div><h2 className="mt-3 font-mono text-[12px] text-zinc-100">{source?.label ?? edge.source} <span className="text-zinc-600">→</span> {target?.label ?? edge.target}</h2><div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => onSelectNode(edge.source)} className="rounded-md border border-zinc-800 p-2 text-left text-[10px] text-zinc-400 hover:border-sky-700">Source<div className="mt-1 truncate font-mono text-zinc-200">{source?.label}</div></button><button onClick={() => onSelectNode(edge.target)} className="rounded-md border border-zinc-800 p-2 text-left text-[10px] text-zinc-400 hover:border-sky-700">Target<div className="mt-1 truncate font-mono text-zinc-200">{target?.label}</div></button></div><div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Why visible</div><p className="mt-1 text-[10.5px] leading-relaxed text-zinc-300">{reason ?? 'Connects visible entities in this projection.'}</p><div className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Evidence</div><div className="mt-1 space-y-2">{evidence.map((record) => <div key={record.id} className="rounded-md border border-zinc-800 p-2"><div className="flex items-center gap-2"><Badge tone={record.strength === 'proven' ? 'green' : record.strength === 'observed' ? 'blue' : 'amber'}>{record.source}</Badge><span className="text-[9px] uppercase tracking-wider text-zinc-500">{record.strength}</span></div><div className="mt-1 text-[10.5px] text-zinc-300">{record.summary}</div>{formatEvidenceLocation(record) && <div className="mt-1 break-all font-mono text-[9.5px] text-sky-300">{formatEvidenceLocation(record)}</div>}</div>)}</div></div>;
}

function RankInspector({ score }: { score: import('../graph/types').CandidateExplanation }) {
  return <details className="mt-3 rounded-md border border-zinc-800 p-2"><summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Why ranked · {score.total.toFixed(2)}</summary><div className="mt-2 text-[10px] text-zinc-300">{score.reason}</div>{score.components.map((component) => <div key={component.signal} className="mt-1 flex items-center gap-2 font-mono text-[9.5px]"><span className="w-[76px] text-zinc-400">{component.signal}</span><span className="text-zinc-600">{component.normalized.toFixed(2)} × {component.weight}</span><span className="ml-auto text-sky-300">+{component.contribution.toFixed(2)}</span></div>)}<pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 text-[8.5px] text-zinc-600">{JSON.stringify(score, null, 2)}</pre></details>;
}

function ComplexityInspector({ item }: { item: { cyclomatic: number; loc: number; fanIn: number; fanOut: number; score: number } }) {
  return <div className="mt-4 grid grid-cols-2 gap-2"><div className="col-span-2 rounded-md border border-zinc-800 p-2"><div className="font-mono text-[18px] text-zinc-100">{item.score}/10</div><div className="text-[10px] text-zinc-500">complexity score</div></div>{[['cyclomatic', item.cyclomatic], ['lines', item.loc], ['fan in', item.fanIn], ['fan out', item.fanOut]].map(([label, value]) => <div key={label} className="rounded-md border border-zinc-800 p-2"><div className="font-mono text-[13px] text-zinc-200">{value}</div><div className="text-[9px] uppercase tracking-wider text-zinc-600">{label}</div></div>)}</div>;
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

function ReviewScreen({ theme, focusMode, setFocusMode, railOpen }: GraphViewProps) {
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
  const reviewIndex = useMemo(() => createGraphIndex(review?.nodes ?? [], review?.edges ?? [], review?.evidence ?? []), [review]);
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
  const graph = projectPRGraphIndex(reviewIndex, { projectionId: 'review', activeNodeId: selected, upstreamDepth, downstreamDepth, edgeKinds: enabledRelationships, branchExpansions, nodeBudget: 30 });
  const selectedEdgeId = investigation.selectedEntity?.kind === 'edge' ? investigation.selectedEntity.id : undefined;
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId);
  const selectedVisibleEdge = graph.visibleGraph.edges.find((edge) => edge.kind === 'real' && edge.id === selectedEdgeId);
  useEffect(() => {
    if (selectedEdgeId && !selectedEdge) dispatch({ type: 'selectEntity', entity: selected ? { kind: 'node', id: selected } : null });
  }, [selectedEdgeId, selectedEdge, selected, dispatch]);
  if (!review) return <div className="flex h-full items-center justify-center p-6"><div className="w-full max-w-[580px] rounded-lg border border-zinc-800 bg-zinc-900/30 p-5"><GitCompare className="h-6 w-6 text-violet-300" /><h1 className="mt-3 text-[16px] font-semibold">Review local Git changes</h1><p className="mt-1 text-[11px] text-zinc-500">Aegir archives the base ref read-only, compares it with another ref or the current working tree, and persists an evidence-backed graph review.</p><ReviewForm baseRef={baseRef} headRef={headRef} setBaseRef={setBaseRef} setHeadRef={setHeadRef} run={run} loading={loading} /><>{error && <div className="mt-3 text-[11px] text-red-300">{error}</div>}</></div></div>;
  const decor: GraphDecor = { tone: {}, badges: {}, edgeTone: {}, edgeLabel: {} };
  for (const node of review.nodes) if (node.pr) { decor.tone![node.id] = node.pr; decor.badges![node.id] = [{ text: node.pr.toUpperCase(), tone: node.pr === 'added' ? 'green' : node.pr === 'removed' ? 'red' : 'blue' }] }
  for (const edge of review.edges) if (edge.pr === 'added' || edge.pr === 'removed') { decor.edgeTone![edge.id] = edge.pr; decor.edgeLabel![edge.id] = edge.pr.toUpperCase() }
  const selectGraphNode = (id: string) => {
    const aggregate = graph.aggregates.find((item) => item.nodeId === id);
    if (aggregate) {
      dispatch({ type: 'expandFrontier', frontierId: aggregate.branchKey });
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
          <div className="ml-auto flex items-center gap-1">
            <button onClick={() => setInspectorOpen((value) => !value)} aria-label={inspectorOpen ? 'Hide review sidebar' : 'Show review sidebar'} title={inspectorOpen ? 'Hide review sidebar' : 'Show review sidebar'} className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">{inspectorOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}</button>
            <button onClick={() => setFocusMode(true)} aria-label="Enter focus mode" title="Focus mode" className="rounded p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"><Maximize2 className="h-3.5 w-3.5" /></button>
            <ReviewForm compact baseRef={baseRef} headRef={headRef} setBaseRef={setBaseRef} setHeadRef={setHeadRef} run={run} loading={loading} />
          </div>
        </div>
        <div className="mt-3 flex gap-5 font-mono text-[10px] text-zinc-400"><span className="text-emerald-300">+{review.summary.addedNodes} nodes</span><span className="text-red-300">−{review.summary.removedNodes} nodes</span><span>{review.summary.modifiedNodes} modified</span><span>{review.summary.addedEdges} added edges</span><span>{review.summary.newViolations} new violations</span><span>{review.contractDiff.changes.length} contract changes</span><span>{graph.nodes.length} visible</span></div>
        {error && <div className="mt-2 text-[11px] text-red-300">{error}</div>}
      </header>}
      {!focusMode && <GraphScopeControls upstream={upstreamDepth} downstream={downstreamDepth} setUpstream={(depth) => dispatch({ type: 'setDepth', direction: 'upstream', depth })} setDownstream={(depth) => dispatch({ type: 'setDepth', direction: 'downstream', depth })} relationships={MODE_RELATIONSHIPS.impact} enabledRelationships={enabledRelationships} toggleRelationship={toggleRelationship} expandedBranches={expandedBranchLabels(branchExpansions, review.nodes)} collapseBranch={(key) => dispatch({ type: 'collapseFrontier', frontierId: key })} />}
      <div className={cn('grid min-h-0 flex-1', !focusMode && inspectorOpen ? 'grid-cols-[1fr_360px]' : 'grid-cols-1')}>
        <div className="relative min-w-0"><SystemGraph nodes={graph.nodes} edges={graph.edges} frontiers={graph.aggregates} decor={decor} selected={selected} selectedEdge={selectedEdgeId} onSelect={selectGraphNode} onEdgeSelect={(id) => dispatch({ type: 'selectEntity', entity: { kind: 'edge', id } })} onDoubleClick={selectGraphNode} fitKey={`${review.id}:${focusMode}:${inspectorOpen}:${railOpen}`} minimap theme={theme} />{focusMode && <button onClick={() => setFocusMode(false)} aria-label="Exit focus mode" className="absolute right-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-950/90 px-2.5 py-1.5 text-[11px] text-zinc-300 shadow-lg hover:bg-zinc-800"><Minimize2 className="h-3.5 w-3.5" /> Exit focus</button>}</div>
        {!focusMode && inspectorOpen && <aside className="overflow-y-auto border-l border-zinc-800">{selectedEdge ? <div className="p-3"><EdgeInspector edge={selectedEdge} nodes={review.nodes} evidence={evidenceForEdge(reviewIndex, selectedEdge)} reason={selectedVisibleEdge?.reason.detail} onSelectNode={(id) => dispatch({ type: 'setFocalNode', nodeId: id })} /></div> : <><div className="border-b border-zinc-800 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Review findings</div>{review.newViolations.map((violation) => <div key={violation.id} className="border-b border-zinc-800 p-3"><div className="flex items-center gap-2"><Badge tone="red">NEW</Badge><span className="font-mono text-[10px] text-zinc-500">{violation.ruleId}</span></div><div className="mt-1 text-[11px] text-zinc-200">{violation.title}</div><div className="mt-1 text-[10px] text-zinc-500">{violation.detail}</div></div>)}{review.contractDiff.changes.map((change) => <div key={change.contractId} className="border-b border-zinc-800 p-3"><div className="flex items-center gap-2"><Badge tone={change.compatibility === 'break' ? 'red' : change.compatibility === 'potential' ? 'orange' : 'green'}>{change.compatibility.toUpperCase()}</Badge><span className="text-[11px] text-zinc-200">{change.name}</span></div><div className="mt-1 text-[10px] text-zinc-500">{change.fields.length} semantic field changes</div></div>)}{review.newViolations.length === 0 && review.contractDiff.changes.length === 0 && <div className="p-4 text-[11px] text-zinc-500">No new deterministic findings or contract changes.</div>}</>}</aside>}
      </div>
    </div>
  );
}

function ReviewForm({ baseRef, headRef, setBaseRef, setHeadRef, run, loading, compact = false }: { baseRef: string; headRef: string; setBaseRef: (value: string) => void; setHeadRef: (value: string) => void; run: () => void; loading: boolean; compact?: boolean }) {
  return <div className={cn('flex gap-2', !compact && 'mt-4')}><input value={baseRef} onChange={(event) => setBaseRef(event.target.value)} placeholder="base ref" className="h-8 w-[150px] rounded-md border border-zinc-700 bg-zinc-950 px-2 font-mono text-[10px] outline-none" /><input value={headRef} onChange={(event) => setHeadRef(event.target.value)} placeholder="HEAD or WORKTREE" className="h-8 w-[150px] rounded-md border border-zinc-700 bg-zinc-950 px-2 font-mono text-[10px] outline-none" /><Btn variant="solid" onClick={run} disabled={loading || !baseRef.trim()}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompare className="h-3.5 w-3.5" />} Analyze</Btn></div>;
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
  const graphViewProps: GraphViewProps = { theme, focusMode, setFocusMode, railOpen };
  return (
    <div className="flex h-full bg-zinc-950 text-zinc-200">
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
