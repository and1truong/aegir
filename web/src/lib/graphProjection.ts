import type { EdgeKind, NodeKind, SysEdge, SysNode } from '../data/types';

export type ProjectionDepth = 0 | 1 | 2 | 3 | 'all';
export type ProjectionDirection = 'upstream' | 'downstream';
export type BranchExpansions = Record<string, number>;

export interface GraphProjectionOptions {
  activeNodeId?: string;
  rootNodeIds?: string[];
  upstreamDepth?: ProjectionDepth;
  downstreamDepth?: ProjectionDepth;
  edgeKinds?: ReadonlySet<EdgeKind>;
  branchExpansions?: BranchExpansions;
  nodeBudget?: number;
  branchLimit?: number;
  branchPageSize?: number;
}

export interface FrontierAggregate {
  nodeId: string;
  branchKey: string;
  parentId: string;
  direction: ProjectionDirection;
  hiddenCount: number;
  label: string;
}

export interface GraphProjection {
  nodes: SysNode[];
  edges: SysEdge[];
  aggregates: FrontierAggregate[];
  rootNodeIds: string[];
  retainedContext: Set<string>;
}

const STRUCTURAL_KINDS = new Set<NodeKind>(['service', 'package']);
const TRANSPARENT_EDGES = new Set<EdgeKind>(['owns', 'implements']);
const DEFAULT_EDGE_KINDS = new Set<EdgeKind>(['calls', 'depends_on', 'owns', 'implements']);

function visualEndpoints(edge: SysEdge) {
  return edge.kind === 'consumes'
    ? { source: edge.target, target: edge.source }
    : { source: edge.source, target: edge.target };
}

function edgeCost(edge: SysEdge, nodeById: Map<string, SysNode>) {
  if (!TRANSPARENT_EDGES.has(edge.kind)) return 1;
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  return source && target && (STRUCTURAL_KINDS.has(source.kind) || STRUCTURAL_KINDS.has(target.kind)) ? 0 : 1;
}

function maxDepth(depth: ProjectionDepth) {
  return depth === 'all' ? Number.POSITIVE_INFINITY : depth;
}

function aggregateCategory(edge: SysEdge, direction: ProjectionDirection) {
  if (direction === 'upstream' && edge.kind === 'calls') return 'callers';
  if (edge.kind === 'consumes') return 'event consumers';
  if (edge.kind === 'publishes') return direction === 'upstream' ? 'event publishers' : 'published events';
  if (edge.kind === 'reads') return direction === 'upstream' ? 'database readers' : 'data dependencies';
  if (edge.kind === 'writes') return direction === 'upstream' ? 'database writers' : 'data dependencies';
  if (edge.kind === 'tests') return 'tests';
  if (edge.kind === 'depends_on') return direction === 'upstream' ? 'dependencies' : 'dependents';
  return direction === 'upstream' ? 'upstream dependencies' : 'downstream dependencies';
}

export function branchKey(parentId: string, direction: ProjectionDirection, category: string) {
  return `${direction}:${encodeURIComponent(parentId)}:${category}`;
}

export function isAggregateNode(id: string) {
  return id.startsWith('aggregate:');
}

function aggregateNodeId(key: string) {
  return `aggregate:${encodeURIComponent(key)}`;
}

function overviewProjection(nodes: SysNode[], edges: SysEdge[], edgeKinds: ReadonlySet<EdgeKind>, budget: number): GraphProjection {
  const preferred = nodes.filter((node) => node.kind === 'service' || node.kind === 'package');
  const fallback = nodes.filter((node) => ['endpoint', 'contract', 'topic', 'table', 'external'].includes(node.kind));
  const candidates = (preferred.length ? preferred : fallback.length ? fallback : nodes)
    .slice()
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
    .slice(0, budget);
  const ids = new Set(candidates.map((node) => node.id));
  return {
    nodes: candidates,
    edges: edges.filter((edge) => edgeKinds.has(edge.kind) && ids.has(edge.source) && ids.has(edge.target)),
    aggregates: [],
    rootNodeIds: [],
    retainedContext: new Set(candidates.map((node) => node.id)),
  };
}

export function projectGraph(nodes: SysNode[], edges: SysEdge[], options: GraphProjectionOptions = {}): GraphProjection {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeKinds = options.edgeKinds ?? DEFAULT_EDGE_KINDS;
  const allowedKinds = new Set<EdgeKind>([...edgeKinds, ...TRANSPARENT_EDGES]);
  const nodeBudget = Math.max(1, options.nodeBudget ?? 30);
  const branchLimit = Math.max(1, options.branchLimit ?? 8);
  const branchPageSize = Math.max(1, options.branchPageSize ?? 8);
  const expansions = options.branchExpansions ?? {};
  const requestedRoots = options.activeNodeId ? [options.activeNodeId] : (options.rootNodeIds ?? []);
  const roots = [...new Set(requestedRoots)].filter((id) => nodeById.has(id)).slice(0, nodeBudget);
  if (roots.length === 0) return overviewProjection(nodes, edges, edgeKinds, nodeBudget);

  const visible = new Set(roots);
  const retainedContext = new Set<string>();
  const aggregates = new Map<string, FrontierAggregate>();
  const traversalEdgeIds = new Set<string>();
  const adjacency = new Map<string, SysEdge[]>();
  for (const edge of edges) {
    if (!allowedKinds.has(edge.kind)) continue;
    const { source, target } = visualEndpoints(edge);
    if (!nodeById.has(source) || !nodeById.has(target)) continue;
    const sourceEdges = adjacency.get(source) ?? [];
    sourceEdges.push(edge);
    adjacency.set(source, sourceEdges);
    const targetEdges = adjacency.get(target) ?? [];
    targetEdges.push(edge);
    adjacency.set(target, targetEdges);
  }
  for (const list of adjacency.values()) list.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));

  function addAggregate(parentId: string, direction: ProjectionDirection, category: string, hiddenCount: number) {
    if (hiddenCount <= 0) return;
    const key = branchKey(parentId, direction, category);
    const nodeId = aggregateNodeId(key);
    aggregates.set(key, { nodeId, branchKey: key, parentId, direction, hiddenCount, label: `+${hiddenCount} ${category}` });
  }

  function walk(direction: ProjectionDirection, depth: ProjectionDepth, directionLimit: number) {
    if (depth === 0) return;
    const limit = maxDepth(depth);
    const best = new Map<string, number>(roots.map((id) => [id, 0]));
    const queue = roots.map((id) => ({ id, depth: 0 }));
    let cursor = 0;
    while (cursor < queue.length) {
      const current = queue[cursor++];
      const grouped = new Map<string, { edge: SysEdge; node: SysNode; nextDepth: number }[]>();
      for (const edge of adjacency.get(current.id) ?? []) {
        const endpoints = visualEndpoints(edge);
        const neighborId = direction === 'downstream'
          ? (endpoints.source === current.id ? endpoints.target : undefined)
          : (endpoints.target === current.id ? endpoints.source : undefined);
        if (!neighborId || neighborId === current.id) continue;
        if (visible.has(neighborId)) continue;
        const node = nodeById.get(neighborId);
        if (!node) continue;
        const category = aggregateCategory(edge, direction);
        const group = grouped.get(category) ?? [];
        group.push({ edge, node, nextDepth: current.depth + edgeCost(edge, nodeById) });
        grouped.set(category, group);
      }

      for (const [category, candidates] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const key = branchKey(current.id, direction, category);
        const pages = Math.max(0, expansions[key] ?? 0);
        const ordered = candidates
          .filter((candidate, index, all) => all.findIndex((item) => item.node.id === candidate.node.id) === index)
          .sort((a, b) => a.nextDepth - b.nextDepth || a.node.label.localeCompare(b.node.label) || a.node.id.localeCompare(b.node.id));
        const globallyAllowed = ordered.filter((candidate) => candidate.nextDepth <= limit);
        const frontierOnly = ordered.filter((candidate) => candidate.nextDepth > limit);
        const eligible = [...globallyAllowed, ...(pages > 0 ? frontierOnly : [])];
        const groupLimit = branchLimit + pages * branchPageSize;
        const remaining = Math.max(0, Math.min(directionLimit, nodeBudget) - visible.size);
        const selected = eligible.slice(0, Math.min(groupLimit, remaining));
        for (const candidate of selected) {
          visible.add(candidate.node.id);
          traversalEdgeIds.add(candidate.edge.id);
          if (candidate.nextDepth === 0) retainedContext.add(candidate.node.id);
          const previous = best.get(candidate.node.id);
          if (previous === undefined || candidate.nextDepth < previous) {
            best.set(candidate.node.id, candidate.nextDepth);
            queue.push({ id: candidate.node.id, depth: candidate.nextDepth });
          }
        }
        addAggregate(current.id, direction, category, Math.max(0, ordered.length - selected.length));
      }
    }
  }

  const upstreamLimit = Math.min(nodeBudget, roots.length + Math.max(4, Math.floor((nodeBudget - roots.length) * 0.35)));
  walk('upstream', options.upstreamDepth ?? 1, upstreamLimit);
  walk('downstream', options.downstreamDepth ?? 2, nodeBudget);

  const realNodes = nodes.filter((node) => visible.has(node.id));
  const aggregateNodes: SysNode[] = [...aggregates.values()]
    .sort((a, b) => a.branchKey.localeCompare(b.branchKey))
    .map((aggregate) => ({
      id: aggregate.nodeId,
      kind: 'service',
      label: aggregate.label,
      description: `${aggregate.direction} frontier`,
      meta: { aggregate: 1, branchKey: aggregate.branchKey, hiddenCount: aggregate.hiddenCount },
    }));
  const visibleWithAggregates = new Set([...visible, ...aggregateNodes.map((node) => node.id)]);
  const rootSet = new Set(roots);
  const realEdges = edges.filter((edge) => {
    const endpoints = visualEndpoints(edge);
    const connectsRoots = rootSet.has(endpoints.source) && rootSet.has(endpoints.target);
    return allowedKinds.has(edge.kind) && visible.has(endpoints.source) && visible.has(endpoints.target) && (traversalEdgeIds.has(edge.id) || connectsRoots);
  });
  const aggregateEdges: SysEdge[] = [...aggregates.values()].map((aggregate) => ({
    id: `edge:${aggregate.nodeId}`,
    source: aggregate.direction === 'downstream' ? aggregate.parentId : aggregate.nodeId,
    target: aggregate.direction === 'downstream' ? aggregate.nodeId : aggregate.parentId,
    kind: 'depends_on',
    label: aggregate.direction === 'downstream' ? 'Expand branch' : 'Expand callers',
  }));

  return {
    nodes: [...realNodes, ...aggregateNodes].filter((node) => visibleWithAggregates.has(node.id)),
    edges: [...realEdges, ...aggregateEdges],
    aggregates: [...aggregates.values()],
    rootNodeIds: roots,
    retainedContext,
  };
}

export function projectPRGraph(nodes: SysNode[], edges: SysEdge[], options: Omit<GraphProjectionOptions, 'rootNodeIds'> = {}) {
  const changed = nodes.filter((node) => node.pr).map((node) => node.id);
  const changedEdges = edges.filter((edge) => edge.pr).flatMap((edge) => [edge.source, edge.target]);
  return projectGraph(nodes, edges, { ...options, rootNodeIds: [...changed, ...changedEdges] });
}
