import type { SysEdge, SysNode } from '../data/types';
import type { AbstractionLevel } from '../investigation/types';

const STRUCTURAL_KINDS = new Set(['calls', 'depends_on', 'reads', 'writes', 'publishes', 'consumes', 'transforms', 'retries']);

export interface MetricDefinition {
  id: 'fan-in' | 'fan-out' | 'coupling' | 'dependency-depth' | 'ownership-boundary-density' | 'bounded-betweenness';
  label: string;
  definition: string;
}

export const metricDefinitions: MetricDefinition[] = [
  { id: 'fan-in', label: 'Fan in', definition: 'Distinct in-scope nodes with a directed relationship into this node.' },
  { id: 'fan-out', label: 'Fan out', definition: 'Distinct in-scope nodes this node directly relates to.' },
  { id: 'coupling', label: 'Coupling', definition: 'Distinct neighboring nodes in either direction; relationship multiplicity is ignored.' },
  { id: 'dependency-depth', label: 'Dependency depth', definition: 'Minimum directed hops from an in-scope root; null when the node is only reachable inside a rootless cycle.' },
  { id: 'ownership-boundary-density', label: 'Ownership boundary density', definition: 'Share of incident owned relationships whose endpoints have different owners.' },
  { id: 'bounded-betweenness', label: 'Bounded betweenness', definition: 'Normalized shortest-path brokerage sampled from at most 64 stable source nodes; used only as a supporting signal.' },
];

export interface NodeStructuralMetrics {
  nodeId: string;
  fanIn: number;
  fanOut: number;
  coupling: number;
  dependencyDepth: number | null;
  ownershipBoundaryDensity: number;
  boundedBetweenness: number;
  edgeIds: string[];
  evidenceIds: string[];
}

export interface StructuralAnalytics {
  version: 1;
  snapshot: { repositoryId: string; snapshotId: number };
  scope: { abstraction: AbstractionLevel; edgeKinds: string[]; nodeCount: number; edgeCount: number; centralitySourceLimit: number };
  definitions: MetricDefinition[];
  nodes: NodeStructuralMetrics[];
  cycles: { id: string; nodeIds: string[]; edgeIds: string[] }[];
  ownershipBoundaryDensity: number;
}

function structuralEdges(nodes: readonly SysNode[], edges: readonly SysEdge[]) {
  const ids = new Set(nodes.map((node) => node.id));
  return edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && STRUCTURAL_KINDS.has(edge.kind)).sort((left, right) => left.id.localeCompare(right.id));
}

function stronglyConnectedComponents(nodeIds: readonly string[], outgoing: Map<string, string[]>) {
  let nextIndex = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const stacked = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string) => {
    index.set(id, nextIndex); low.set(id, nextIndex); nextIndex += 1; stack.push(id); stacked.add(id);
    for (const target of outgoing.get(id) ?? []) {
      if (!index.has(target)) { visit(target); low.set(id, Math.min(low.get(id)!, low.get(target)!)) }
      else if (stacked.has(target)) low.set(id, Math.min(low.get(id)!, index.get(target)!));
    }
    if (low.get(id) !== index.get(id)) return;
    const component: string[] = [];
    while (stack.length) {
      const item = stack.pop()!; stacked.delete(item); component.push(item);
      if (item === id) break;
    }
    components.push(component.sort());
  };
  for (const id of [...nodeIds].sort()) if (!index.has(id)) visit(id);
  return components;
}

function boundedBetweenness(nodeIds: readonly string[], outgoing: Map<string, string[]>, sourceLimit: number) {
  const scores = new Map(nodeIds.map((id) => [id, 0]));
  const sources = [...nodeIds].sort().slice(0, sourceLimit);
  for (const source of sources) {
    const stack: string[] = [];
    const predecessors = new Map(nodeIds.map((id) => [id, [] as string[]]));
    const paths = new Map(nodeIds.map((id) => [id, 0]));
    const distance = new Map(nodeIds.map((id) => [id, -1]));
    paths.set(source, 1); distance.set(source, 0);
    const queue = [source];
    while (queue.length) {
      const node = queue.shift()!; stack.push(node);
      for (const target of outgoing.get(node) ?? []) {
        if (distance.get(target) === -1) { distance.set(target, distance.get(node)! + 1); queue.push(target) }
        if (distance.get(target) === distance.get(node)! + 1) { paths.set(target, paths.get(target)! + paths.get(node)!); predecessors.get(target)!.push(node) }
      }
    }
    const dependency = new Map(nodeIds.map((id) => [id, 0]));
    while (stack.length) {
      const node = stack.pop()!;
      for (const predecessor of predecessors.get(node)!) dependency.set(predecessor, dependency.get(predecessor)! + (paths.get(predecessor)! / paths.get(node)!) * (1 + dependency.get(node)!));
      if (node !== source) scores.set(node, scores.get(node)! + dependency.get(node)!);
    }
  }
  const maximum = Math.max(0, ...scores.values());
  return new Map([...scores].map(([id, score]) => [id, maximum ? score / maximum : 0]));
}

export function computeStructuralAnalytics(input: { repositoryId: string; snapshotId: number; abstraction: AbstractionLevel; nodes: readonly SysNode[]; edges: readonly SysEdge[]; centralitySourceLimit?: number }): StructuralAnalytics {
  const nodes = [...input.nodes].sort((left, right) => left.id.localeCompare(right.id));
  const edges = structuralEdges(nodes, input.edges);
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const incoming = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const incident = new Map(nodes.map((node) => [node.id, [] as SysEdge[]]));
  for (const edge of edges) {
    outgoing.get(edge.source)!.push(edge.target); incoming.get(edge.target)!.push(edge.source);
    incident.get(edge.source)!.push(edge); incident.get(edge.target)!.push(edge);
  }
  for (const values of [...outgoing.values(), ...incoming.values()]) values.sort();
  const roots = nodes.map((node) => node.id).filter((id) => incoming.get(id)!.length === 0);
  const depth = new Map<string, number>();
  const queue = roots.map((id) => ({ id, depth: 0 }));
  while (queue.length) {
    const current = queue.shift()!;
    if ((depth.get(current.id) ?? Infinity) <= current.depth) continue;
    depth.set(current.id, current.depth);
    for (const target of outgoing.get(current.id)!) queue.push({ id: target, depth: current.depth + 1 });
  }
  const sourceLimit = Math.min(input.centralitySourceLimit ?? 64, nodes.length);
  const centrality = boundedBetweenness(nodes.map((node) => node.id), outgoing, sourceLimit);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  let ownedEdges = 0;
  let boundaryEdges = 0;
  for (const edge of edges) {
    const sourceOwner = nodeById.get(edge.source)?.owner;
    const targetOwner = nodeById.get(edge.target)?.owner;
    if (sourceOwner && targetOwner) { ownedEdges += 1; if (sourceOwner !== targetOwner) boundaryEdges += 1 }
  }
  const metrics = nodes.map((node) => {
    const nodeEdges = incident.get(node.id)!;
    const owned = nodeEdges.filter((edge) => nodeById.get(edge.source)?.owner && nodeById.get(edge.target)?.owner);
    const boundaries = owned.filter((edge) => nodeById.get(edge.source)?.owner !== nodeById.get(edge.target)?.owner);
    return {
      nodeId: node.id,
      fanIn: new Set(incoming.get(node.id)).size,
      fanOut: new Set(outgoing.get(node.id)).size,
      coupling: new Set(nodeEdges.map((edge) => edge.source === node.id ? edge.target : edge.source)).size,
      dependencyDepth: depth.get(node.id) ?? null,
      ownershipBoundaryDensity: owned.length ? boundaries.length / owned.length : 0,
      boundedBetweenness: centrality.get(node.id) ?? 0,
      edgeIds: nodeEdges.map((edge) => edge.id).sort(),
      evidenceIds: [...new Set(nodeEdges.flatMap((edge) => edge.evidenceRefs ?? []))].sort(),
    };
  });
  const cycles = stronglyConnectedComponents(nodes.map((node) => node.id), outgoing).filter((component) => component.length > 1 || edges.some((edge) => edge.source === component[0] && edge.target === component[0])).map((nodeIds) => ({
    id: `cycle:${nodeIds.join('|')}`,
    nodeIds,
    edgeIds: edges.filter((edge) => nodeIds.includes(edge.source) && nodeIds.includes(edge.target)).map((edge) => edge.id),
  }));
  return {
    version: 1,
    snapshot: { repositoryId: input.repositoryId, snapshotId: input.snapshotId },
    scope: { abstraction: input.abstraction, edgeKinds: [...STRUCTURAL_KINDS].sort(), nodeCount: nodes.length, edgeCount: edges.length, centralitySourceLimit: sourceLimit },
    definitions: metricDefinitions,
    nodes: metrics,
    cycles,
    ownershipBoundaryDensity: ownedEdges ? boundaryEdges / ownedEdges : 0,
  };
}

export function rankStructuralHotspots(analytics: StructuralAnalytics, options: { complexityByNode?: ReadonlyMap<string, number>; changedNodeIds?: ReadonlySet<string> } = {}) {
  const maxCoupling = Math.max(1, ...analytics.nodes.map((node) => node.coupling));
  return analytics.nodes.map((node) => {
    const coupling = node.coupling / maxCoupling;
    const complexity = Math.min(1, (options.complexityByNode?.get(node.nodeId) ?? 0) / 10);
    const changed = options.changedNodeIds?.has(node.nodeId) ? 1 : 0;
    const boundary = node.ownershipBoundaryDensity;
    const centrality = node.boundedBetweenness;
    const score = coupling * 0.35 + complexity * 0.25 + changed * 0.2 + boundary * 0.1 + centrality * 0.1;
    return { nodeId: node.nodeId, score, question: 'Where is structural risk concentrated?', edgeIds: node.edgeIds, evidenceIds: node.evidenceIds, contributions: { coupling, complexity, changed, boundary, centrality } };
  }).sort((left, right) => right.score - left.score || left.nodeId.localeCompare(right.nodeId));
}
