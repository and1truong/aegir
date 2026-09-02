import type { EdgeKind, EvidenceStrength, SysEdge } from '../data/types.ts';
import type { EvidencePolicy, GraphIndex } from '../graph/types.ts';
import { eligibleEvidenceIds } from '../graph/projection/evidencePolicy.ts';

export type PathQueryId = 'semantic-dependency' | 'runtime-observed' | 'failure-propagation' | 'data-lineage';
export type PathDirection = 'forward' | 'reverse' | 'both';

export interface PathQueryDefinition {
  id: PathQueryId;
  label: string;
  description: string;
  relations: Partial<Record<EdgeKind, PathDirection>>;
  requireRuntimeEvidence?: boolean;
}

export interface PathQueryRequest {
  definitionId: PathQueryId;
  sourceNodeId: string;
  targetNodeId: string;
  evidencePolicy: EvidencePolicy;
  maxAlternatives?: number;
}

export interface PathStep {
  edgeId: string;
  sourceNodeId: string;
  targetNodeId: string;
  relation: EdgeKind;
  semanticCost: number;
  evidenceIds: string[];
  evidenceStrength: EvidenceStrength;
  explanation: string;
}

export interface SemanticPath {
  id: string;
  queryId: PathQueryId;
  nodeIds: string[];
  edgeIds: string[];
  steps: PathStep[];
  semanticHops: number;
  evidencePenalty: number;
  explanation: string;
}

export interface PathQueryResult {
  definition: PathQueryDefinition;
  sourceNodeId: string;
  targetNodeId: string;
  path?: SemanticPath;
  alternatives: SemanticPath[];
  noPath?: { code: 'missing-endpoint' | 'same-endpoint' | 'runtime-evidence-gap' | 'disconnected'; message: string };
}

const structural: Partial<Record<EdgeKind, PathDirection>> = { owns: 'both', implements: 'both' };

export const pathQueryDefinitions: Record<PathQueryId, PathQueryDefinition> = {
  'semantic-dependency': {
    id: 'semantic-dependency',
    label: 'Semantic dependency',
    description: 'Minimal dependency route; containment is context, not a semantic hop.',
    relations: { ...structural, calls: 'forward', depends_on: 'forward', publishes: 'forward', consumes: 'reverse' },
  },
  'runtime-observed': {
    id: 'runtime-observed',
    label: 'Runtime observed',
    description: 'Only routes backed by runtime observations.',
    relations: { ...structural, calls: 'forward', publishes: 'forward', consumes: 'reverse' },
    requireRuntimeEvidence: true,
  },
  'failure-propagation': {
    id: 'failure-propagation',
    label: 'Failure propagation',
    description: 'Routes that can carry failure through calls, retries, dependencies, or events.',
    relations: { ...structural, calls: 'both', depends_on: 'both', retries: 'forward', publishes: 'forward', consumes: 'reverse' },
  },
  'data-lineage': {
    id: 'data-lineage',
    label: 'Data lineage',
    description: 'Routes through mutations, reads, transformations, and asynchronous data flow.',
    relations: { ...structural, writes: 'forward', reads: 'reverse', transforms: 'forward', publishes: 'forward', consumes: 'reverse' },
  },
};

const STRENGTH_PENALTY: Record<EvidenceStrength, number> = { proven: 0, observed: 1, inferred: 2 };

function endpoints(edge: SysEdge, direction: PathDirection) {
  if (direction === 'reverse') return [{ source: edge.target, target: edge.source }];
  if (direction === 'both') return [{ source: edge.source, target: edge.target }, { source: edge.target, target: edge.source }];
  return [{ source: edge.source, target: edge.target }];
}

function evidenceForStep(index: GraphIndex, edge: SysEdge, policy: EvidencePolicy, runtimeOnly: boolean) {
  const ids = eligibleEvidenceIds(index, edge, policy).filter((id) => !runtimeOnly || index.evidenceById.get(id)?.source === 'RUNTIME');
  const strength = ids.reduce<EvidenceStrength>((best, id) => {
    const value = index.evidenceById.get(id)?.strength ?? 'inferred';
    return STRENGTH_PENALTY[value] < STRENGTH_PENALTY[best] ? value : best;
  }, 'inferred');
  return { ids, strength };
}

function pathId(queryId: PathQueryId, edgeIds: readonly string[]) {
  return `path:${queryId}:${edgeIds.map(encodeURIComponent).join('>')}`;
}

function compareQueue(left: QueueEntry, right: QueueEntry) {
  return left.semanticHops - right.semanticHops
    || left.evidencePenalty - right.evidencePenalty
    || left.edgeIds.length - right.edgeIds.length
    || left.edgeIds.join('\u0000').localeCompare(right.edgeIds.join('\u0000'));
}

interface QueueEntry {
  nodeId: string;
  nodeIds: string[];
  edgeIds: string[];
  steps: PathStep[];
  semanticHops: number;
  evidencePenalty: number;
  structuralDirection?: 'up' | 'down';
}

function search(index: GraphIndex, definition: PathQueryDefinition, request: PathQueryRequest, runtimeOnly: boolean) {
  const adjacency = new Map<string, Array<{ edge: SysEdge; source: string; target: string }>>();
  for (const edge of index.edges) {
    const direction = definition.relations[edge.kind];
    if (!direction) continue;
    const evidence = evidenceForStep(index, edge, request.evidencePolicy, runtimeOnly);
    if (evidence.ids.length === 0) continue;
    for (const pair of endpoints(edge, direction)) {
      const values = adjacency.get(pair.source) ?? [];
      values.push({ edge, ...pair });
      adjacency.set(pair.source, values);
    }
  }
  for (const values of adjacency.values()) values.sort((a, b) => a.edge.kind.localeCompare(b.edge.kind) || a.edge.id.localeCompare(b.edge.id) || a.target.localeCompare(b.target));

  const wanted = Math.max(1, Math.min(4, 1 + (request.maxAlternatives ?? 2)));
  const queue: QueueEntry[] = [{ nodeId: request.sourceNodeId, nodeIds: [request.sourceNodeId], edgeIds: [], steps: [], semanticHops: 0, evidencePenalty: 0 }];
  const results: SemanticPath[] = [];
  let expansions = 0;
  while (queue.length > 0 && results.length < wanted && expansions < 5000) {
    queue.sort(compareQueue);
    const current = queue.shift()!;
    if (current.nodeId === request.targetNodeId) {
      results.push({
        id: pathId(definition.id, current.edgeIds),
        queryId: definition.id,
        nodeIds: current.nodeIds,
        edgeIds: current.edgeIds,
        steps: current.steps,
        semanticHops: current.semanticHops,
        evidencePenalty: current.evidencePenalty,
        explanation: `${definition.label}: ${current.semanticHops} semantic hop${current.semanticHops === 1 ? '' : 's'} across ${current.edgeIds.length} relationship${current.edgeIds.length === 1 ? '' : 's'}.`,
      });
      continue;
    }
    expansions++;
    for (const candidate of adjacency.get(current.nodeId) ?? []) {
      if (current.nodeIds.includes(candidate.target)) continue;
      const evidence = evidenceForStep(index, candidate.edge, request.evidencePolicy, runtimeOnly);
      const isStructural = candidate.edge.kind === 'owns' || candidate.edge.kind === 'implements';
      const structuralDirection = isStructural ? (candidate.source === candidate.edge.source ? 'down' as const : 'up' as const) : undefined;
      if (current.structuralDirection === 'up' && structuralDirection === 'down') continue;
      const semanticCost = isStructural ? 0 : 1;
      const step: PathStep = {
        edgeId: candidate.edge.id,
        sourceNodeId: candidate.source,
        targetNodeId: candidate.target,
        relation: candidate.edge.kind,
        semanticCost,
        evidenceIds: evidence.ids,
        evidenceStrength: evidence.strength,
        explanation: isStructural ? `${candidate.edge.kind} provides zero-cost containment context.` : `${candidate.edge.kind} advances the ${definition.label.toLowerCase()} route with ${evidence.strength} evidence.`,
      };
      queue.push({
        nodeId: candidate.target,
        nodeIds: [...current.nodeIds, candidate.target],
        edgeIds: [...current.edgeIds, candidate.edge.id],
        steps: [...current.steps, step],
        semanticHops: current.semanticHops + semanticCost,
        evidencePenalty: current.evidencePenalty + STRENGTH_PENALTY[evidence.strength],
        structuralDirection,
      });
    }
  }
  return results;
}

export function runPathQuery(index: GraphIndex, request: PathQueryRequest): PathQueryResult {
  const definition = pathQueryDefinitions[request.definitionId];
  const base = { definition, sourceNodeId: request.sourceNodeId, targetNodeId: request.targetNodeId, alternatives: [] as SemanticPath[] };
  if (!index.nodeById.has(request.sourceNodeId) || !index.nodeById.has(request.targetNodeId)) return { ...base, noPath: { code: 'missing-endpoint', message: 'The source or target is not present in this graph context.' } };
  if (request.sourceNodeId === request.targetNodeId) return { ...base, noPath: { code: 'same-endpoint', message: 'Choose a target different from the focal node.' } };
  const paths = search(index, definition, request, Boolean(definition.requireRuntimeEvidence));
  if (paths.length > 0) return { ...base, path: paths[0], alternatives: paths.slice(1) };
  if (definition.requireRuntimeEvidence && search(index, definition, request, false).length > 0) {
    return { ...base, noPath: { code: 'runtime-evidence-gap', message: 'A static route exists, but one or more segments have no eligible runtime evidence.' } };
  }
  return { ...base, noPath: { code: 'disconnected', message: `No ${definition.label.toLowerCase()} route connects the selected endpoints under the current evidence policy.` } };
}
