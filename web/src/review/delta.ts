import type { EvidenceRecord, GraphDelta, GraphDeltaStatus, GraphEdgeDelta, GraphNodeDelta, SysEdge, SysNode } from '../data/types.ts';

export type ReviewGraphPolicy = 'changes-only' | 'changes-impact' | 'blast-radius';

interface DeltaReviewLike {
  payloadVersion?: number;
  nodes: SysNode[];
  edges: SysEdge[];
  evidence?: EvidenceRecord[];
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

export function graphForReviewPolicy(review: DeltaReviewLike, delta: GraphDelta, policy: ReviewGraphPolicy, options?: { exactSource?: boolean }) {
  if (policy !== 'changes-only') return { nodes: review.nodes, edges: review.edges, evidence: review.evidence };
  const nodeById = new Map(review.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(review.edges.map((edge) => [edge.id, edge]));
  const changedEdges = delta.edges.flatMap((entry) => {
    const body = options?.exactSource ? edgeById.get(entry.id) : entry.after ?? entry.before;
    return body ? [options?.exactSource ? body : bodyWithStatus(body, entry.status)] : [];
  });
  const requiredNodeIds = new Set(delta.nodes.map((entry) => entry.id));
  changedEdges.forEach((edge) => { requiredNodeIds.add(edge.source); requiredNodeIds.add(edge.target) });
  const changedNodeById = new Map(delta.nodes.flatMap((entry) => {
    const body = options?.exactSource ? nodeById.get(entry.id) : entry.after ?? entry.before;
    return body ? [[entry.id, options?.exactSource ? body : bodyWithStatus(body, entry.status)] as const] : [];
  }));
  const nodes = [...requiredNodeIds].flatMap((id) => {
    const node = changedNodeById.get(id) ?? nodeById.get(id);
    return node ? [node] : [];
  }).sort((a, b) => a.id.localeCompare(b.id));
  return { nodes, edges: changedEdges.sort((a, b) => a.id.localeCompare(b.id)), evidence: review.evidence };
}

export function graphForReviewSnapshot(review: DeltaReviewLike, delta: GraphDelta, side: 'base' | 'head', archived?: { nodes: SysNode[]; edges: SysEdge[]; evidence?: EvidenceRecord[] }) {
  const nodes = new Map((archived?.nodes ?? review.nodes).map((node) => [node.id, node]));
  const edges = new Map((archived?.edges ?? review.edges).map((edge) => [edge.id, edge]));
  for (const entry of delta.nodes) {
    const selected = side === 'base' ? entry.before : entry.after;
    if (selected) nodes.set(entry.id, selected);
    else if ((side === 'base' && entry.status === 'added') || (side === 'head' && entry.status === 'removed')) nodes.delete(entry.id);
  }
  for (const entry of delta.edges) {
    const selected = side === 'base' ? entry.before : entry.after;
    if (selected) edges.set(entry.id, selected);
    else if ((side === 'base' && entry.status === 'added') || (side === 'head' && entry.status === 'removed')) edges.delete(entry.id);
  }
  return {
    nodes: [...nodes.values()].map((node) => ({ ...node, pr: undefined })).sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].map((edge) => ({ ...edge, pr: undefined })).sort((left, right) => left.id.localeCompare(right.id)),
    evidence: archived?.evidence ?? review.evidence,
  };
}
