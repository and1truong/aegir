import type { GraphDelta, GraphDeltaStatus, GraphEdgeDelta, GraphNodeDelta, SysEdge, SysNode } from '../data/types.ts';

export type ReviewGraphPolicy = 'changes-only' | 'changes-impact' | 'blast-radius';

interface DeltaReviewLike {
  payloadVersion?: number;
  nodes: SysNode[];
  edges: SysEdge[];
  delta?: GraphDelta;
}

function legacyNodeDelta(node: SysNode): GraphNodeDelta | undefined {
  if (!node.pr) return undefined;
  const body = { ...node };
  return {
    id: node.id,
    status: node.pr,
    before: node.pr === 'removed' ? body : undefined,
    after: node.pr === 'removed' ? undefined : body,
    changeReasons: [{ kind: 'legacy-change', detail: 'Recovered from a persisted v1 review.' }],
  };
}

function legacyEdgeDelta(edge: SysEdge): GraphEdgeDelta | undefined {
  if (!edge.pr) return undefined;
  const body = { ...edge };
  return {
    id: edge.id,
    status: edge.pr,
    before: edge.pr === 'removed' ? body : undefined,
    after: edge.pr === 'removed' ? undefined : body,
    changeReasons: [{ kind: 'legacy-change', detail: 'Recovered from a persisted v1 review.' }],
  };
}

export function adaptGraphDelta(review: DeltaReviewLike): GraphDelta {
  if (review.delta) return review.delta;
  return {
    nodes: review.nodes.flatMap((node) => legacyNodeDelta(node) ?? []),
    edges: review.edges.flatMap((edge) => legacyEdgeDelta(edge) ?? []),
  };
}

export function deltaStatusMaps(delta: GraphDelta) {
  return {
    nodes: new Map(delta.nodes.map((entry) => [entry.id, entry.status])),
    edges: new Map(delta.edges.map((entry) => [entry.id, entry.status])),
  };
}

function bodyWithStatus<T extends SysNode | SysEdge>(body: T, status: GraphDeltaStatus): T {
  return { ...body, pr: status === 'unchanged' ? undefined : status };
}

export function graphForReviewPolicy(review: DeltaReviewLike, delta: GraphDelta, policy: ReviewGraphPolicy) {
  if (policy !== 'changes-only') return { nodes: review.nodes, edges: review.edges };
  const nodeById = new Map(review.nodes.map((node) => [node.id, node]));
  const changedEdges = delta.edges.flatMap((entry) => {
    const body = entry.after ?? entry.before;
    return body ? [bodyWithStatus(body, entry.status)] : [];
  });
  const requiredNodeIds = new Set(delta.nodes.map((entry) => entry.id));
  changedEdges.forEach((edge) => { requiredNodeIds.add(edge.source); requiredNodeIds.add(edge.target) });
  const changedNodeById = new Map(delta.nodes.flatMap((entry) => {
    const body = entry.after ?? entry.before;
    return body ? [[entry.id, bodyWithStatus(body, entry.status)] as const] : [];
  }));
  const nodes = [...requiredNodeIds].flatMap((id) => {
    const node = changedNodeById.get(id) ?? nodeById.get(id);
    return node ? [node] : [];
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, edges: changedEdges.sort((a, b) => a.id.localeCompare(b.id)) };
}
