import type { SysEdge, SysNode } from '../../data/types';
import type { CandidateExplanation, GraphIndex, ProjectionDefinition, RelevanceSignal } from '../types';

export interface RelevanceCandidate {
  node: SysNode;
  edge: SysEdge;
  fromNodeId: string;
  semanticDepth: number;
}

const significantKinds = new Set<SysNode['kind']>(['endpoint', 'transaction', 'external', 'table', 'topic', 'contract', 'database', 'broker']);
const relationPriority: Record<SysEdge['kind'], number> = { calls: 0, writes: 1, publishes: 2, consumes: 3, reads: 4, retries: 5, tests: 6, depends_on: 7, transforms: 8, owns: 9, implements: 10 };
const kindPriority: Record<SysNode['kind'], number> = { endpoint: 0, transaction: 1, external: 2, contract: 3, table: 4, topic: 5, cache: 6, function: 7, method: 7, service: 8, package: 9, test: 10, database: 11, broker: 11 };

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

function runtimeSignal(index: GraphIndex, nodeId: string) {
  const telemetry = index.telemetryByNode.get(nodeId);
  if (!telemetry) return 0;
  const traffic = Math.log1p((telemetry.rpm ?? 0) + (telemetry.qps ?? 0) * 60) / Math.log1p(10_000);
  const latency = (telemetry.p99 ?? 0) / 1_000;
  const errors = (telemetry.errorRate ?? 0) / 5;
  const lag = (telemetry.lag ?? 0) / 10_000;
  return clamp(Math.max(traffic, latency, errors, lag));
}

function rawSignals(index: GraphIndex, candidate: RelevanceCandidate): Record<RelevanceSignal, number> {
  const { node, edge, fromNodeId, semanticDepth } = candidate;
  const fromMembership = index.membership.get(fromNodeId);
  const membership = index.membership.get(node.id);
  const degree = (index.fanInByNode.get(node.id) ?? 0) + (index.fanOutByNode.get(node.id) ?? 0);
  const change = node.pr ? 1 : edge.pr ? 0.9 : 0;
  const contract = node.kind === 'contract' ? 1 : edge.kind === 'implements' || (node.kind === 'topic' && (edge.kind === 'publishes' || edge.kind === 'consumes')) ? 0.65 : 0;
  const failure = edge.kind === 'retries' ? 1 : node.kind === 'external' && edge.sync !== false ? 0.9 : ['writes', 'publishes'].includes(edge.kind) ? 0.55 : index.findingNodeIds.has(node.id) ? 0.7 : 0;
  const crossesOwner = Boolean(fromMembership?.owner && membership?.owner && fromMembership.owner !== membership.owner);
  return {
    change,
    direct: semanticDepth <= 1 ? 1 : 1 / Math.max(2, semanticDepth),
    runtime: runtimeSignal(index, node.id),
    contract,
    failure,
    ownership: crossesOwner ? 1 : 0,
    architecture: significantKinds.has(node.kind) ? 1 : index.findingNodeIds.has(node.id) ? 0.75 : 0,
    structural: clamp(Math.log1p(degree) / Math.log(20)),
  };
}

export function scoreCandidate(index: GraphIndex, definition: ProjectionDefinition, candidate: RelevanceCandidate): CandidateExplanation {
  const raw = rawSignals(index, candidate);
  const evidenceIds = [...(index.evidenceBySubject.get(`edge:${candidate.edge.id}`) ?? [])];
  const components = (Object.keys(raw) as RelevanceSignal[]).flatMap((signal) => {
    const weight = definition.relevanceWeights[signal] ?? 0;
    const normalized = raw[signal];
    if (weight === 0 || normalized === 0) return [];
    return [{ signal, raw: raw[signal], normalized, weight, contribution: normalized * weight, evidenceIds }];
  }).sort((a, b) => b.contribution - a.contribution || a.signal.localeCompare(b.signal));
  const total = components.reduce((sum, item) => sum + item.contribution, 0);
  const leading = components.slice(0, 2).map((item) => item.signal).join(' + ');
  return { total, components, reason: leading ? `Ranked by ${leading}.` : `Reachable at semantic depth ${candidate.semanticDepth}.` };
}

export function compareCandidates(left: RelevanceCandidate & { score: CandidateExplanation }, right: RelevanceCandidate & { score: CandidateExplanation }) {
  return right.score.total - left.score.total
    || left.semanticDepth - right.semanticDepth
    || relationPriority[left.edge.kind] - relationPriority[right.edge.kind]
    || kindPriority[left.node.kind] - kindPriority[right.node.kind]
    || left.node.label.localeCompare(right.node.label)
    || left.node.id.localeCompare(right.node.id);
}
