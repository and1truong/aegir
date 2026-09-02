import { useEffect, useMemo, useRef } from 'react';
import {
  ReactFlow, ReactFlowProvider, Background, BackgroundVariant, Controls, MiniMap, Handle, Position, BaseEdge, EdgeLabelRenderer, getBezierPath,
  MarkerType, useReactFlow, useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps, type EdgeProps,
} from '@xyflow/react';
import { AlertTriangle, Flame } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { SysNode, SysEdge, Severity, CoverageStatus, NodeKind } from '../../data/types';
import { layout } from '../../lib/layout';
import { KindIcon, CoverageIcon } from '../../product/ui';
import type { FrontierAggregate } from '../../lib/graphProjection';

// ---------------------------------------------------------------------------
// Decoration model shared by all graph modes
// ---------------------------------------------------------------------------
export type NodeTone =
  | 'default' | 'root' | 'direct' | 'transitive' | 'covered' | 'partial' | 'uncovered' | 'unknown'
  | 'added' | 'removed' | 'modified' | 'safe' | 'conditional' | 'potential' | 'break' | 'violation' | 'hot' | 'contract';

export type EdgeTone = 'default' | 'calls' | 'reads' | 'writes' | 'publishes' | 'consumes' | 'retries' | 'depends' | 'added' | 'removed' | 'covered' | 'partial' | 'uncovered' | 'violation' | 'warn' | 'safe' | 'conditional' | 'break' | 'network' | 'async' | 'persistence' | 'highlight' | 'transitive' | 'direct';

export interface GraphBadge { text: string; tone: 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'orange' | 'fuchsia' | 'cyan' }
export interface GraphMarker { id: string; severity: Severity; ruleId: string }
export interface GraphGroup { id: string; label: string; kind: 'process' | 'transaction' | 'async' | 'network'; members: string[] }
export interface GraphOutcome { id: string; label: string; status: CoverageStatus }

export interface GraphDecor {
  tone?: Record<string, NodeTone>;
  heat?: Record<string, number>;
  metrics?: Record<string, string[]>;
  sub?: Record<string, string>;
  badges?: Record<string, GraphBadge[]>;
  markers?: Record<string, GraphMarker[]>;
  dimmed?: Set<string>;
  highlight?: Set<string>;
  edgeTone?: Record<string, EdgeTone>;
  edgeWidth?: Record<string, number>;
  edgeLabel?: Record<string, string>;
  edgeDimmed?: Set<string>;
  edgeHighlight?: Set<string>;
  outcomes?: Record<string, GraphOutcome[]>;
  groups?: GraphGroup[];
  useOp?: boolean;
}

export interface SystemGraphProps {
  nodes: SysNode[];
  edges: SysEdge[];
  frontiers?: FrontierAggregate[];
  decor?: GraphDecor;
  selected?: string;
  selectedEdge?: string;
  onSelect?: (id: string) => void;
  onEdgeSelect?: (id: string) => void;
  onDoubleClick?: (id: string) => void;
  onMarkerClick?: (violationId: string) => void;
  minimap?: boolean;
  compact?: boolean;
  className?: string;
  fitKey?: string;
  rankdir?: 'LR' | 'TB';
  theme?: 'light' | 'dark';
}

// ---------------------------------------------------------------------------
// Flow node / edge data
// ---------------------------------------------------------------------------
type SysData = {
  n: SysNode;
  label: string;
  sub?: string;
  tone: NodeTone;
  heat?: number;
  metrics?: string[];
  badges?: GraphBadge[];
  markers?: GraphMarker[];
  dimmed?: boolean;
  highlighted?: boolean;
  selected?: boolean;
  compact?: boolean;
  onMarkerClick?: (id: string) => void;
};
type OutcomeData = { label: string; status: CoverageStatus; dimmed?: boolean };
type BoundaryData = { label: string; kind: GraphGroup['kind'] };
type FrontierData = { label: string; direction: FrontierAggregate['direction']; hiddenCount: number; selected?: boolean };
type SysEdgeData = { tone: EdgeTone; width: number; dashed?: boolean; dotted?: boolean; label?: string; dimmed?: boolean; highlighted?: boolean; selected?: boolean; kind: string };

type SysFlowNode = Node<SysData, 'sys'>;
type OutcomeFlowNode = Node<OutcomeData, 'outcome'>;
type BoundaryFlowNode = Node<BoundaryData, 'boundary'>;
type FrontierFlowNode = Node<FrontierData, 'frontier'>;
type AnyNode = SysFlowNode | OutcomeFlowNode | BoundaryFlowNode | FrontierFlowNode;
type SysFlowEdge = Edge<SysEdgeData, 'sys'>;

// ---------------------------------------------------------------------------
// Styling tables
// ---------------------------------------------------------------------------
const toneClass: Record<NodeTone, string> = {
  default: 'border-zinc-700/80 bg-zinc-900',
  root: 'border-sky-400/70 bg-sky-950/40',
  direct: 'border-amber-400/70 bg-amber-950/40',
  transitive: 'border-amber-700/60 bg-amber-950/15',
  covered: 'border-emerald-500/60 bg-emerald-950/30',
  partial: 'border-amber-400/70 bg-amber-950/30',
  uncovered: 'border-red-500/70 bg-red-950/40',
  unknown: 'border-zinc-700 border-dashed bg-zinc-900/60',
  added: 'border-emerald-400/80 bg-emerald-950/40',
  removed: 'border-red-500/70 border-dashed bg-red-950/20 opacity-70',
  modified: 'border-sky-700/70 bg-zinc-900',
  safe: 'border-emerald-500/60 bg-emerald-950/25',
  conditional: 'border-amber-400/70 bg-amber-950/25',
  potential: 'border-orange-400/70 bg-orange-950/25',
  break: 'border-red-500/80 bg-red-950/40',
  violation: 'border-red-500/70 bg-red-950/30',
  hot: 'border-orange-400/80 bg-orange-950/40',
  contract: 'border-indigo-400/70 bg-indigo-950/40',
};

const edgeColor: Record<EdgeTone, string> = {
  default: '#52525b',
  calls: '#71717a',
  reads: '#d4a72c',
  writes: '#f59e0b',
  publishes: '#a78bfa',
  consumes: '#a78bfa',
  retries: '#f472b6',
  depends: '#52525b',
  added: '#34d399',
  removed: '#f87171',
  covered: '#34d399',
  partial: '#f59e0b',
  uncovered: '#f87171',
  violation: '#f87171',
  warn: '#f59e0b',
  safe: '#34d399',
  conditional: '#fbbf24',
  break: '#f87171',
  network: '#fb923c',
  async: '#a78bfa',
  persistence: '#f59e0b',
  highlight: '#7dd3fc',
  transitive: '#b45309',
  direct: '#f59e0b',
};

const badgeClass: Record<GraphBadge['tone'], string> = {
  neutral: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  green: 'bg-emerald-950 text-emerald-300 border-emerald-800',
  amber: 'bg-amber-950 text-amber-300 border-amber-800',
  red: 'bg-red-950 text-red-300 border-red-800',
  blue: 'bg-sky-950 text-sky-300 border-sky-800',
  violet: 'bg-violet-950 text-violet-300 border-violet-800',
  orange: 'bg-orange-950 text-orange-300 border-orange-800',
  fuchsia: 'bg-fuchsia-950 text-fuchsia-300 border-fuchsia-800',
  cyan: 'bg-cyan-950 text-cyan-300 border-cyan-800',
};

const groupClass: Record<GraphGroup['kind'], { box: string; label: string }> = {
  process: { box: 'border-zinc-700/70 bg-zinc-800/10', label: 'text-zinc-500 bg-zinc-900/90 border-zinc-700/70' },
  transaction: { box: 'border-fuchsia-500/60 bg-fuchsia-950/15 border-dashed', label: 'text-fuchsia-300 bg-zinc-900/95 border-fuchsia-800' },
  async: { box: 'border-violet-500/50 bg-violet-950/10 border-dotted', label: 'text-violet-300 bg-zinc-900/95 border-violet-800' },
  network: { box: 'border-orange-500/50 bg-orange-950/10 border-dashed', label: 'text-orange-300 bg-zinc-900/95 border-orange-800' },
};

// ---------------------------------------------------------------------------
// Node views
// ---------------------------------------------------------------------------
function SysNodeView({ data }: NodeProps<SysFlowNode>) {
  const { n, label, sub, tone, heat, metrics, badges, markers, dimmed, highlighted, selected, compact } = data;
  const heatStyle = heat !== undefined && heat > 0 ? { backgroundColor: `rgba(239, 68, 68, ${0.06 + heat * 0.32})`, borderColor: `rgba(248, 113, 113, ${0.25 + heat * 0.6})` } : undefined;
  const infra = ['table', 'topic', 'cache', 'external', 'database', 'broker'].includes(n.kind);
  return (
    <div
      className={cn(
        'relative rounded-md border shadow-sm transition-opacity',
        toneClass[tone],
        infra && tone === 'default' && 'bg-zinc-950/80',
        n.kind === 'endpoint' && tone === 'default' && 'border-emerald-800/60',
        n.kind === 'external' && tone === 'default' && 'border-orange-800/60',
        n.kind === 'topic' && tone === 'default' && 'border-violet-800/60',
        n.kind === 'table' && tone === 'default' && 'border-amber-800/50',
        compact ? 'px-2 py-1' : 'px-2.5 py-1.5',
        dimmed && 'opacity-25',
        highlighted && 'ring-1 ring-sky-300/60',
        selected && 'ring-2 ring-sky-400 ring-offset-1 ring-offset-zinc-950',
      )}
      style={heatStyle}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div className="flex items-center gap-1.5">
        <KindIcon kind={n.kind} className={compact ? 'h-3 w-3' : undefined} />
        <span className={cn('truncate font-mono font-medium text-zinc-100', compact ? 'text-[10.5px]' : 'text-[11.5px]', tone === 'removed' && 'line-through text-zinc-400')}>{label}</span>
        {badges?.map((b, i) => (
          <span key={i} className={cn('ml-auto rounded-sm border px-1 font-mono text-[9px] font-semibold leading-4', badgeClass[b.tone])}>
            {b.text}
          </span>
        ))}
      </div>
      {sub && <div className={cn('truncate text-zinc-500', compact ? 'text-[9.5px]' : 'text-[10px]')}>{sub}</div>}
      {metrics && metrics.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 font-mono text-[10px] leading-3 text-cyan-300">
          {metrics.map((m, i) => (
            <span key={i}>{m}</span>
          ))}
        </div>
      )}
      {markers && markers.length > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onMarkerClick?.(markers[0].id);
          }}
          title={markers.map((m) => `${m.ruleId} (${m.severity})`).join(', ')}
          className={cn(
            'absolute -right-2 -top-2.5 flex h-5 items-center gap-0.5 rounded-sm border px-1 font-mono text-[9.5px] font-bold shadow',
            markers.some((m) => m.severity === 'high') ? 'border-red-500 bg-red-950 text-red-200' : markers.some((m) => m.severity === 'medium') ? 'border-amber-500 bg-amber-950 text-amber-200' : 'border-sky-600 bg-sky-950 text-sky-200',
          )}
        >
          <AlertTriangle className="h-3 w-3" />
          {markers.length > 1 ? markers.length : markers[0].ruleId}
        </button>
      )}
      {tone === 'hot' && <Flame className="absolute -left-2 -top-2 h-4 w-4 text-orange-400" />}
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

function OutcomeView({ data }: NodeProps<OutcomeFlowNode>) {
  const cls: Record<CoverageStatus, string> = {
    covered: 'border-emerald-700/70 text-emerald-200',
    partial: 'border-amber-600/70 text-amber-200',
    uncovered: 'border-red-600/80 text-red-200 bg-red-950/40',
    unknown: 'border-zinc-700 text-zinc-400',
  };
  return (
    <div className={cn('flex items-center gap-1.5 rounded-full border bg-zinc-950 px-2 py-0.5 font-mono text-[10px]', cls[data.status], data.dimmed && 'opacity-25')}>
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <CoverageIcon status={data.status} className="h-3 w-3" />
      {data.label}
    </div>
  );
}

function BoundaryView({ data }: NodeProps<BoundaryFlowNode>) {
  const c = groupClass[data.kind];
  return (
    <div className={cn('h-full w-full rounded-lg border', c.box)}>
      <div className={cn('absolute -top-2.5 left-3 rounded-sm border px-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider', c.label)}>{data.label}</div>
    </div>
  );
}

function FrontierView({ data }: NodeProps<FrontierFlowNode>) {
  return (
    <div className={cn('rounded-md border border-dashed border-sky-700/70 bg-sky-950/30 px-2.5 py-1.5 font-mono text-[10.5px] text-sky-200', data.selected && 'ring-2 ring-sky-400 ring-offset-1 ring-offset-zinc-950')}>
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <span>{data.label}</span>
      <div className="text-[9px] uppercase tracking-wider text-sky-500">{data.direction} frontier</div>
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edge view
// ---------------------------------------------------------------------------
function SysEdgeView({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }: EdgeProps<SysFlowEdge>) {
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 });
  const d = data!;
  const color = d.highlighted ? edgeColor.highlight : edgeColor[d.tone];
  return (
    <>
      <BaseEdge id={`${id}:hit`} path={path} style={{ stroke: 'transparent', strokeWidth: 14, pointerEvents: 'stroke', cursor: 'pointer' }} />
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ stroke: d.selected ? edgeColor.highlight : color, strokeWidth: d.selected ? Math.max(d.width, 3) : d.highlighted ? Math.max(d.width, 2.2) : d.width, strokeDasharray: d.dashed ? '6 4' : d.dotted ? '2 4' : undefined, opacity: d.dimmed ? 0.15 : 0.95 }}
      />
      {d.label && (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, opacity: d.dimmed ? 0.15 : 1 }}
            className="pointer-events-none absolute rounded-sm border border-zinc-800 bg-zinc-950/95 px-1 py-px font-mono text-[9px] leading-3 text-zinc-400 nodrag nopan"
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = { sys: SysNodeView, outcome: OutcomeView, boundary: BoundaryView, frontier: FrontierView };
const edgeTypes = { sys: SysEdgeView };

// ---------------------------------------------------------------------------
// Build + layout
// ---------------------------------------------------------------------------
function nodeSize(n: SysNode, label: string, sub: string | undefined, metrics: string[] | undefined, compact: boolean) {
  const base = compact ? 9 : 10.5;
  const width = Math.min(compact ? 220 : 280, Math.max(compact ? 120 : 150, label.length * (compact ? 6.3 : 7) + 56 + (metrics ? 20 : 0)));
  let height = compact ? 28 : 34;
  if (sub) height += compact ? 12 : 14;
  if (metrics && metrics.length) height += 16;
  void base;
  void n;
  return { width, height };
}

const kindOrder: Record<NodeKind, number> = { endpoint: 0, function: 1, method: 1, transaction: 1, service: 2, package: 3, table: 4, cache: 4, topic: 5, external: 6, contract: 7, test: 8, database: 9, broker: 9 };

function build(props: SystemGraphProps): { nodes: AnyNode[]; edges: SysFlowEdge[] } {
  const { nodes, edges, frontiers = [], decor = {}, selected, compact = false, onMarkerClick } = props;
  const items: { id: string; width: number; height: number }[] = [];
  const flowNodes: AnyNode[] = [];
  const meta = new Map<string, { width: number; height: number }>();

  for (const n of nodes) {
    const label = decor.useOp && n.op ? n.op : n.label;
    const sub = decor.sub?.[n.id];
    const metrics = decor.metrics?.[n.id];
    const size = nodeSize(n, label, sub, metrics, compact);
    meta.set(n.id, size);
    items.push({ id: n.id, ...size });
    flowNodes.push({
      id: n.id,
      type: 'sys',
      position: { x: 0, y: 0 },
      draggable: true,
      data: {
        n, label, sub, tone: decor.tone?.[n.id] ?? 'default', heat: decor.heat?.[n.id], metrics, badges: decor.badges?.[n.id], markers: decor.markers?.[n.id],
        dimmed: decor.dimmed?.has(n.id), highlighted: decor.highlight?.has(n.id), selected: selected === n.id, compact, onMarkerClick,
      },
    });
  }

  const links: { source: string; target: string }[] = edges.map((e) => (e.kind === 'consumes' ? { source: e.target, target: e.source } : { source: e.source, target: e.target }));
  const flowEdges: SysFlowEdge[] = edges.map((e) => {
    const tone = decor.edgeTone?.[e.id] ?? (e.kind as EdgeTone);
    const width = decor.edgeWidth?.[e.id] ?? (e.kind === 'retries' ? 1 : 1.3);
    const dashed = e.kind === 'retries' || e.kind === 'depends_on' || tone === 'removed' || e.boundary === 'network';
    const dotted = e.kind === 'publishes' || e.kind === 'consumes';
    const [s, t] = e.kind === 'consumes' ? [e.target, e.source] : [e.source, e.target];
    const highlighted = decor.edgeHighlight?.has(e.id);
    const color = highlighted ? edgeColor.highlight : edgeColor[tone in edgeColor ? tone : 'default'];
    return {
      id: e.id,
      source: s,
      target: t,
      type: 'sys',
      interactionWidth: 20,
      focusable: true,
      ariaLabel: `${e.kind} edge from ${s} to ${t}`,
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 12, height: 12 },
      data: { tone: tone in edgeColor ? tone : 'default', width, dashed, dotted, label: decor.edgeLabel?.[e.id], dimmed: decor.edgeDimmed?.has(e.id), highlighted, selected: props.selectedEdge === e.id, kind: e.kind },
    };
  });

  for (const frontier of frontiers) {
    const width = Math.max(130, frontier.label.length * 6.3 + 32);
    const height = 42;
    items.push({ id: frontier.nodeId, width, height });
    flowNodes.push({ id: frontier.nodeId, type: 'frontier', position: { x: 0, y: 0 }, draggable: false, data: { label: frontier.label, direction: frontier.direction, hiddenCount: frontier.hiddenCount, selected: selected === frontier.nodeId } });
    const source = frontier.direction === 'downstream' ? frontier.parentId : frontier.nodeId;
    const target = frontier.direction === 'downstream' ? frontier.nodeId : frontier.parentId;
    links.push({ source, target });
    flowEdges.push({
      id: `frontier-link:${frontier.branchKey}`,
      source,
      target,
      type: 'sys',
      interactionWidth: 20,
      focusable: true,
      ariaLabel: `${frontier.direction} frontier with ${frontier.hiddenCount} hidden nodes`,
      markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor.transitive, width: 12, height: 12 },
      data: { tone: 'transitive', width: 1.2, dashed: true, label: 'expand', kind: 'frontier-link' },
    });
  }

  // outcome pseudo nodes (coverage)
  if (decor.outcomes) {
    for (const [parent, outs] of Object.entries(decor.outcomes)) {
      if (!meta.has(parent)) continue;
      outs.forEach((o) => {
        const id = `${parent}::${o.id}`;
        const width = Math.max(90, o.label.length * 6.2 + 34);
        items.push({ id, width, height: 22 });
        flowNodes.push({ id, type: 'outcome', position: { x: 0, y: 0 }, draggable: false, selectable: false, data: { label: o.label, status: o.status, dimmed: decor.dimmed?.has(parent) } });
        links.push({ source: parent, target: id });
        flowEdges.push({
          id: `${parent}->${id}`,
          source: parent,
          target: id,
          type: 'sys',
          data: { tone: o.status === 'covered' ? 'covered' : o.status === 'partial' ? 'partial' : o.status === 'uncovered' ? 'uncovered' : 'default', width: 1, dotted: true, dimmed: decor.dimmed?.has(parent), kind: 'outcome' },
        });
      });
    }
  }

  const pos = layout(items, links, { rankdir: props.rankdir ?? 'LR', ranksep: compact ? 46 : 64, nodesep: compact ? 14 : 22 });

  // keep group members contiguous within a column
  if (decor.groups?.length) {
    const groupIndex = new Map<string, string>();
    decor.groups.forEach((g) => g.members.forEach((m) => groupIndex.set(m, (groupIndex.get(m) ?? '') + '|' + g.id)));
    const cols = new Map<number, string[]>();
    const sizeOf = new Map(items.map((i) => [i.id, i]));
    for (const it of items) {
      const p = pos.get(it.id)!;
      const key = Math.round((p.x + it.width / 2) / 10);
      if (!cols.has(key)) cols.set(key, []);
      cols.get(key)!.push(it.id);
    }
    for (const ids of cols.values()) {
      if (ids.length < 2) continue;
      const slots = ids.map((id) => pos.get(id)!.y + sizeOf.get(id)!.height / 2).sort((a, b) => a - b);
      const sorted = [...ids].sort((a, b) => {
        const ga = groupIndex.get(a) ?? '~';
        const gb = groupIndex.get(b) ?? '~';
        if (ga !== gb) return ga < gb ? -1 : 1;
        const ka = kindOrder[nodes.find((n) => n.id === a)?.kind ?? 'function'] ?? 5;
        const kb = kindOrder[nodes.find((n) => n.id === b)?.kind ?? 'function'] ?? 5;
        if (ka !== kb) return ka - kb;
        return pos.get(a)!.y - pos.get(b)!.y;
      });
      sorted.forEach((id, i) => {
        const p = pos.get(id)!;
        pos.set(id, { x: p.x, y: slots[i] - sizeOf.get(id)!.height / 2 });
      });
    }
  }

  for (const fn of flowNodes) {
    const p = pos.get(fn.id);
    if (p) fn.position = p;
  }

  // boundary boxes
  const boundaryNodes: AnyNode[] = [];
  if (decor.groups) {
    for (const g of decor.groups) {
      const members = g.members.filter((m) => meta.has(m));
      if (members.length === 0) continue;
      const pad = g.kind === 'process' ? 22 : 12;
      const xs = members.map((m) => pos.get(m)!.x);
      const ys = members.map((m) => pos.get(m)!.y);
      const x2 = members.map((m) => pos.get(m)!.x + meta.get(m)!.width);
      const y2 = members.map((m) => pos.get(m)!.y + meta.get(m)!.height);
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad - 6;
      const w = Math.max(...x2) - x + pad;
      const h = Math.max(...y2) - y + pad;
      boundaryNodes.push({ id: `group:${g.id}`, type: 'boundary', position: { x, y }, draggable: false, selectable: false, focusable: false, connectable: false, className: 'pointer-events-none', zIndex: g.kind === 'process' ? -20 : -10, style: { width: w, height: h }, data: { label: g.label, kind: g.kind } });
    }
  }

  return { nodes: [...boundaryNodes, ...flowNodes], edges: flowEdges };
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
function Canvas(props: SystemGraphProps) {
  const built = useMemo(() => build(props), [props.nodes, props.edges, props.frontiers, props.decor, props.selected, props.selectedEdge, props.compact, props.rankdir]); // eslint-disable-line react-hooks/exhaustive-deps
  const [nodes, setNodes, onNodesChange] = useNodesState<AnyNode>(built.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<SysFlowEdge>(built.edges);
  const { fitView } = useReactFlow();
  const light = props.theme === 'light';
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const shouldFit = useRef(true);
  const lastFitKey = useRef(props.fitKey);

  const structureKey = useMemo(() => built.nodes.map((n) => n.id).join(',') + '|' + (props.fitKey ?? ''), [built.nodes, props.fitKey]);

  useEffect(() => {
    const previous = positions.current;
    const retained = built.nodes.filter((node) => previous.has(node.id));
    const anchorId = props.selected && previous.has(props.selected) && built.nodes.some((node) => node.id === props.selected)
      ? props.selected
      : retained[0]?.id;
    const builtAnchor = anchorId ? built.nodes.find((node) => node.id === anchorId)?.position : undefined;
    const previousAnchor = anchorId ? previous.get(anchorId) : undefined;
    const offset = builtAnchor && previousAnchor ? { x: previousAnchor.x - builtAnchor.x, y: previousAnchor.y - builtAnchor.y } : { x: 0, y: 0 };
    const fitKeyChanged = lastFitKey.current !== props.fitKey;
    const selectedWasVisible = !props.selected || previous.has(props.selected);
    const retainedRatio = previous.size === 0 ? 1 : retained.length / previous.size;
    shouldFit.current = previous.size === 0 || retained.length === 0 || retainedRatio < 0.5 || fitKeyChanged || !selectedWasVisible;
    lastFitKey.current = props.fitKey;
    setNodes(built.nodes.map((node) => ({
      ...node,
      position: previous.get(node.id) ?? { x: node.position.x + offset.x, y: node.position.y + offset.y },
    })));
    setEdges(built.edges);
  }, [built, props.fitKey, props.selected, setNodes, setEdges]);

  useEffect(() => {
    positions.current = new Map(nodes.map((node) => [node.id, node.position]));
  }, [nodes]);

  useEffect(() => {
    if (!shouldFit.current) return;
    const t = setTimeout(() => fitView({ padding: 0.18, duration: 300, maxZoom: 1.15 }), 60);
    return () => clearTimeout(t);
  }, [structureKey, fitView]);

  return (
    <ReactFlow<AnyNode, SysFlowEdge>
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={(_, n) => (n.type === 'sys' || n.type === 'frontier') && props.onSelect?.(n.id)}
      onNodeDoubleClick={(_, n) => (n.type === 'sys' || n.type === 'frontier') && props.onDoubleClick?.(n.id)}
      onEdgeClick={(_, edge) => props.onEdgeSelect?.(edge.id)}
      fitView
      minZoom={0.15}
      maxZoom={2}
      panOnScroll
      zoomOnScroll={false}
      nodesConnectable={false}
      deleteKeyCode={null}
      proOptions={{ hideAttribution: true }}
      colorMode={light ? 'light' : 'dark'}
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1} color={light ? '#dbe1ea' : '#27272a'} />
      <Controls showInteractive={false} position="bottom-right" />
      {props.minimap && <MiniMap pannable zoomable position="bottom-left" nodeColor={(n) => (n.type === 'boundary' ? 'transparent' : n.type === 'outcome' ? (light ? '#e2e8f0' : '#27272a') : light ? '#94a3b8' : '#52525b')} nodeStrokeColor={(n) => (n.type === 'boundary' ? (light ? '#e2e8f0' : '#27272a') : 'transparent')} nodeStrokeWidth={2} maskColor={light ? 'rgba(241,245,249,0.7)' : 'rgba(9,9,11,0.7)'} style={{ width: 140, height: 90 }} />}
    </ReactFlow>
  );
}

export function SystemGraph(props: SystemGraphProps) {
  return (
    <div className={cn('relative h-full w-full', props.className)}>
      <ReactFlowProvider>
        <Canvas {...props} />
      </ReactFlowProvider>
    </div>
  );
}
