import type { EdgeKind, NodeKind, SysEdge } from '../../data/types';
import type { CandidateExplanation, FrontierGroup, GraphIndex, InclusionReason, ProjectionDefinition, ProjectionDepth, ProjectionDirection, VisibleEdge, VisibleGraph, VisibleNode } from '../types';
import { compareCandidates, scoreCandidate, type RelevanceCandidate } from './relevance.ts';

export type FrontierExpansions = Record<string, number>;

export interface ProjectionRequest {
  activeNodeId?: string;
  rootNodeIds?: string[];
  upstreamDepth?: ProjectionDepth;
  downstreamDepth?: ProjectionDepth;
  edgeKinds?: ReadonlySet<EdgeKind>;
  frontierExpansions?: FrontierExpansions;
  nodeBudget?: number;
  hardBudget?: number;
  branchLimit?: number;
  branchPageSize?: number;
}

const STRUCTURAL_KINDS = new Set<NodeKind>(['service', 'package']);

export function frontierId(parentId: string, direction: ProjectionDirection, category: string) {
  return `${direction}:${encodeURIComponent(parentId)}:${category}`;
}

function visualEndpoints(edge: SysEdge, definition: ProjectionDefinition) {
  return definition.relationshipPolicy.reverseVisualKinds.includes(edge.kind)
    ? { source: edge.target, target: edge.source }
    : { source: edge.source, target: edge.target };
}

function semanticCost(edge: SysEdge, index: GraphIndex, definition: ProjectionDefinition) {
  const policy = definition.relationshipPolicy;
  if (!policy.transparentKinds.includes(edge.kind) || !policy.zeroCostThroughStructuralNodes) return 1;
  const source = index.nodeById.get(edge.source);
  const target = index.nodeById.get(edge.target);
  return source && target && (STRUCTURAL_KINDS.has(source.kind) || STRUCTURAL_KINDS.has(target.kind)) ? 0 : 1;
}

function maxDepth(depth: ProjectionDepth) {
  return depth === 'all' ? Number.POSITIVE_INFINITY : depth;
}

function category(edge: SysEdge, direction: ProjectionDirection) {
  if (direction === 'upstream' && edge.kind === 'calls') return 'callers';
  if (edge.kind === 'consumes') return 'event consumers';
  if (edge.kind === 'publishes') return direction === 'upstream' ? 'event publishers' : 'published events';
  if (edge.kind === 'reads') return direction === 'upstream' ? 'database readers' : 'data dependencies';
  if (edge.kind === 'writes') return direction === 'upstream' ? 'database writers' : 'data dependencies';
  if (edge.kind === 'tests') return 'tests';
  if (edge.kind === 'depends_on') return direction === 'upstream' ? 'dependencies' : 'dependents';
  return direction === 'upstream' ? 'upstream dependencies' : 'downstream dependencies';
}

function explanation(reason: Extract<InclusionReason, { kind: 'root' | 'overview' }>): CandidateExplanation {
  const contribution = reason.kind === 'root' ? 100 : 10;
  return {
    total: contribution,
    components: [{ signal: reason.kind, raw: contribution, normalized: contribution / 100, weight: 1, contribution, evidenceIds: [] }],
    reason: reason.detail,
  };
}

function overview(index: GraphIndex, definition: ProjectionDefinition, edgeKinds: ReadonlySet<EdgeKind>, budget: number): VisibleGraph {
  const preferred = index.nodes.filter((node) => node.kind === 'service' || node.kind === 'package');
  const fallback = index.nodes.filter((node) => ['endpoint', 'contract', 'topic', 'table', 'external'].includes(node.kind));
  const candidates = (preferred.length ? preferred : fallback.length ? fallback : index.nodes)
    .slice()
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const selected = candidates.slice(0, budget);
  const ids = new Set(selected.map((node) => node.id));
  const reason: InclusionReason = { kind: 'overview', detail: 'Included in the bounded structural overview.' };
  const nodes: VisibleNode[] = selected.map((node) => ({ kind: 'real', id: node.id, node, reason, score: explanation(reason) }));
  const edges: VisibleEdge[] = index.edges
    .filter((edge) => edgeKinds.has(edge.kind) && ids.has(edge.source) && ids.has(edge.target))
    .map((edge) => ({ kind: 'real', id: edge.id, edge, ...visualEndpoints(edge, definition), canonicalEdgeIds: [edge.id], reason, evidenceIds: [...(index.evidenceBySubject.get(`edge:${edge.id}`) ?? [])] }));
  return {
    revision: `${definition.id}:overview:${selected.map((node) => node.id).join(',')}`,
    projectionId: definition.id,
    nodes,
    edges,
    rootNodeIds: [],
    warnings: [],
    retainedContext: new Set(selected.map((node) => node.id)),
    stats: { candidates: candidates.length, visibleReal: selected.length, visibleFrontiers: 0, pruned: Math.max(0, candidates.length - selected.length) },
  };
}

export function projectVisibleGraph(index: GraphIndex, definition: ProjectionDefinition, request: ProjectionRequest = {}): VisibleGraph {
  const edgeKinds = request.edgeKinds ?? new Set(definition.relationshipPolicy.defaultKinds);
  const allowedKinds = new Set<EdgeKind>([...edgeKinds, ...definition.relationshipPolicy.transparentKinds]);
  const nodeBudget = Math.max(1, request.nodeBudget ?? 30);
  const hardBudget = Math.max(nodeBudget, request.hardBudget ?? 40);
  const branchLimit = Math.max(1, request.branchLimit ?? 8);
  const branchPageSize = Math.max(1, request.branchPageSize ?? 8);
  const expansions = request.frontierExpansions ?? {};
  const requestedRoots = request.activeNodeId ? [request.activeNodeId] : (request.rootNodeIds ?? []);
  const validRequestedRoots = [...new Set(requestedRoots)].filter((id) => index.nodeById.has(id));
  const roots = validRequestedRoots.slice(0, nodeBudget);
  const warnings: VisibleGraph['warnings'] = [];
  if (requestedRoots.some((id) => !index.nodeById.has(id))) warnings.push({ code: 'missing-root', message: 'One or more requested roots are not present in this graph context.' });
  if (validRequestedRoots.length > roots.length) warnings.push({ code: 'root-budget', message: `${validRequestedRoots.length - roots.length} roots exceed the real-node budget.` });
  if (roots.length === 0) {
    const result = overview(index, definition, edgeKinds, nodeBudget);
    return { ...result, warnings: [...warnings, ...result.warnings] };
  }

  const visible = new Set(roots);
  const retainedContext = new Set<string>();
  const reasons = new Map<string, InclusionReason>(roots.map((id) => [id, { kind: 'root', detail: id === request.activeNodeId ? 'Selected focal node.' : 'Required projection root.' }]));
  const scores = new Map<string, CandidateExplanation>();
  const frontiers = new Map<string, FrontierGroup>();
  const traversalEdgeIds = new Set<string>();
  const candidateIds = new Set<string>(roots);

  function walk(direction: ProjectionDirection, depth: ProjectionDepth, directionLimit: number) {
    if (depth === 0) return;
    const limit = maxDepth(depth);
    const best = new Map<string, number>(roots.map((id) => [id, 0]));
    const queue = roots.map((id) => ({ id, depth: 0 }));
    let cursor = 0;
    while (cursor < queue.length) {
      const current = queue[cursor++];
      const grouped = new Map<string, Array<RelevanceCandidate & { nextDepth: number; score: CandidateExplanation }>>();
      for (const edgeId of index.adjacentByNode.get(current.id) ?? []) {
        const edge = index.edgeById.get(edgeId);
        if (!edge || !allowedKinds.has(edge.kind)) continue;
        const endpoints = visualEndpoints(edge, definition);
        const neighborId = direction === 'downstream'
          ? (endpoints.source === current.id ? endpoints.target : undefined)
          : (endpoints.target === current.id ? endpoints.source : undefined);
        if (!neighborId || neighborId === current.id || visible.has(neighborId)) continue;
        const node = index.nodeById.get(neighborId);
        if (!node) continue;
        candidateIds.add(neighborId);
        const key = category(edge, direction);
        const group = grouped.get(key) ?? [];
        const nextDepth = current.depth + semanticCost(edge, index, definition);
        const relevance = { node, edge, fromNodeId: current.id, semanticDepth: nextDepth };
        group.push({ ...relevance, nextDepth, score: scoreCandidate(index, definition, relevance) });
        grouped.set(key, group);
      }

      for (const [groupCategory, candidates] of [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const id = frontierId(current.id, direction, groupCategory);
        const pages = Math.max(0, expansions[id] ?? 0);
        const ordered = candidates
          .filter((candidate, candidateIndex, all) => all.findIndex((item) => item.node.id === candidate.node.id) === candidateIndex)
          .sort(compareCandidates);
        const withinDepth = ordered.filter((candidate) => candidate.nextDepth <= limit);
        const beyondDepth = ordered.filter((candidate) => candidate.nextDepth > limit);
        const eligible = [...withinDepth, ...(pages > 0 ? beyondDepth : [])];
        const groupLimit = branchLimit + pages * branchPageSize;
        const remaining = Math.max(0, Math.min(directionLimit, nodeBudget) - visible.size);
        const selected = eligible.slice(0, Math.min(groupLimit, remaining));
        for (const candidate of selected) {
          visible.add(candidate.node.id);
          traversalEdgeIds.add(candidate.edge.id);
          if (candidate.nextDepth === 0) retainedContext.add(candidate.node.id);
          reasons.set(candidate.node.id, { kind: 'traversal', direction, semanticDepth: candidate.nextDepth, viaEdgeId: candidate.edge.id, fromNodeId: current.id, detail: `${direction} via ${candidate.edge.kind} at semantic depth ${candidate.nextDepth}.` });
          scores.set(candidate.node.id, candidate.score);
          const previous = best.get(candidate.node.id);
          if (previous === undefined || candidate.nextDepth < previous) {
            best.set(candidate.node.id, candidate.nextDepth);
            queue.push({ id: candidate.node.id, depth: candidate.nextDepth });
          }
        }
        const hidden = ordered.slice(selected.length);
        if (hidden.length > 0) {
          frontiers.set(id, { id, parentId: current.id, direction, category: groupCategory, hiddenCount: hidden.length, memberNodeIds: hidden.map((candidate) => candidate.node.id), label: `+${hidden.length} ${groupCategory}`, withinDepth: hidden.every((candidate) => candidate.nextDepth <= limit) });
        }
      }
    }
  }

  const upstreamLimit = Math.min(nodeBudget, roots.length + Math.max(4, Math.floor((nodeBudget - roots.length) * 0.35)));
  walk('upstream', request.upstreamDepth ?? definition.defaultDepth.upstream, upstreamLimit);
  walk('downstream', request.downstreamDepth ?? definition.defaultDepth.downstream, nodeBudget);

  const realNodes: VisibleNode[] = index.nodes.filter((node) => visible.has(node.id)).map((node) => {
    const reason = reasons.get(node.id) ?? { kind: 'root' as const, detail: 'Required projection root.' };
    const score = scores.get(node.id) ?? explanation(reason as Extract<InclusionReason, { kind: 'root' | 'overview' }>);
    return { kind: 'real', id: node.id, node, reason, score };
  });
  const visibleFrontiers = [...frontiers.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, Math.max(0, hardBudget - realNodes.length));
  if (frontiers.size > visibleFrontiers.length) warnings.push({ code: 'hard-budget', message: `${frontiers.size - visibleFrontiers.length} frontier controls were omitted by the hard budget.` });
  const frontierNodes: VisibleNode[] = visibleFrontiers.map((frontier) => ({ kind: 'frontier', id: frontier.id, frontier, reason: { kind: 'frontier', detail: `Summarizes ${frontier.hiddenCount} hidden ${frontier.category}.` } }));
  const rootSet = new Set(roots);
  const realEdges: VisibleEdge[] = index.edges.flatMap((edge) => {
    if (!allowedKinds.has(edge.kind)) return [];
    const endpoints = visualEndpoints(edge, definition);
    const connectsRoots = rootSet.has(endpoints.source) && rootSet.has(endpoints.target);
    if (!visible.has(endpoints.source) || !visible.has(endpoints.target) || (!traversalEdgeIds.has(edge.id) && !connectsRoots)) return [];
    const reason = reasons.get(endpoints.target) ?? reasons.get(endpoints.source) ?? { kind: 'root' as const, detail: 'Connects required roots.' };
    return [{ kind: 'real' as const, id: edge.id, edge, ...endpoints, canonicalEdgeIds: [edge.id], reason, evidenceIds: [...(index.evidenceBySubject.get(`edge:${edge.id}`) ?? [])] }];
  });
  const frontierEdges: VisibleEdge[] = visibleFrontiers.map((frontier) => ({ kind: 'frontier-link', id: `frontier-link:${frontier.id}`, source: frontier.direction === 'downstream' ? frontier.parentId : frontier.id, target: frontier.direction === 'downstream' ? frontier.id : frontier.parentId, canonicalEdgeIds: [], reason: { kind: 'frontier', detail: `Connects the ${frontier.category} frontier to its parent.` }, evidenceIds: [] }));
  const pruned = Math.max(0, candidateIds.size - realNodes.length);
  const revisionParts = [definition.id, roots.join(','), request.upstreamDepth ?? definition.defaultDepth.upstream, request.downstreamDepth ?? definition.defaultDepth.downstream, [...edgeKinds].sort().join(','), Object.entries(expansions).sort().map(([id, pages]) => `${id}=${pages}`).join(',')];
  return {
    revision: revisionParts.join('|'),
    projectionId: definition.id,
    nodes: [...realNodes, ...frontierNodes],
    edges: [...realEdges, ...frontierEdges],
    focalNodeId: request.activeNodeId,
    rootNodeIds: roots,
    warnings,
    retainedContext,
    stats: { candidates: candidateIds.size, visibleReal: realNodes.length, visibleFrontiers: frontierNodes.length, pruned },
  };
}
