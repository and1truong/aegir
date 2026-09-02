import type { EdgeKind, EvidenceRecord, SysEdge, SysNode } from '../data/types';

export type ProjectionDirection = 'upstream' | 'downstream';
export type ProjectionDepth = 0 | 1 | 2 | 3 | 'all';

export interface GraphIndex {
  nodes: readonly SysNode[];
  edges: readonly SysEdge[];
  nodeById: ReadonlyMap<string, SysNode>;
  edgeById: ReadonlyMap<string, SysEdge>;
  incomingByNode: ReadonlyMap<string, readonly string[]>;
  outgoingByNode: ReadonlyMap<string, readonly string[]>;
  adjacentByNode: ReadonlyMap<string, readonly string[]>;
  membership: ReadonlyMap<string, { service?: string; pkg?: string; owner?: string }>;
  evidenceById: ReadonlyMap<string, EvidenceRecord>;
  evidenceBySubject: ReadonlyMap<string, readonly string[]>;
  fanInByNode: ReadonlyMap<string, number>;
  fanOutByNode: ReadonlyMap<string, number>;
  telemetryByNode: ReadonlyMap<string, { rpm?: number; qps?: number; p99?: number; errorRate?: number; lag?: number }>;
  findingNodeIds: ReadonlySet<string>;
}

export interface GraphIndexFacts {
  telemetry?: Array<{ nodeId: string; rpm?: number; qps?: number; p99?: number; errorRate?: number; lag?: number }>;
  findingNodeIds?: Iterable<string>;
}

export interface EvidencePolicy {
  maximumLevel: 'proven' | 'observed' | 'inferred';
  includeStale: boolean;
}

export type RelevanceSignal = 'change' | 'direct' | 'runtime' | 'contract' | 'failure' | 'ownership' | 'architecture' | 'structural';
export type RelevanceWeights = Partial<Record<RelevanceSignal, number>>;

export interface RelationshipPolicy {
  defaultKinds: readonly EdgeKind[];
  transparentKinds: readonly EdgeKind[];
  reverseVisualKinds: readonly EdgeKind[];
  zeroCostThroughStructuralNodes: boolean;
}

export interface ProjectionDefinition {
  id: string;
  label: string;
  description: string;
  relationshipPolicy: RelationshipPolicy;
  defaultDepth: { upstream: ProjectionDepth; downstream: ProjectionDepth };
  layoutStrategy: 'dependency-LR' | 'dataflow-LR' | 'review-LR';
  relevanceWeights: RelevanceWeights;
  category: 'question' | 'signal';
  evidenceRequirement?: 'runtime' | 'ownership' | 'changes';
}

export type InclusionReason =
  | { kind: 'root'; detail: string }
  | { kind: 'overview'; detail: string }
  | { kind: 'traversal'; direction: ProjectionDirection; semanticDepth: number; viaEdgeId: string; fromNodeId: string; detail: string }
  | { kind: 'frontier'; detail: string };

export interface CandidateExplanation {
  total: number;
  components: Array<{ signal: RelevanceSignal | 'root' | 'overview'; raw: number; normalized: number; weight: number; contribution: number; evidenceIds: string[] }>;
  reason: string;
}

export interface FrontierGroup {
  id: string;
  parentId: string;
  parentFrontierId?: string;
  direction: ProjectionDirection;
  category: string;
  dimension: 'service' | 'package' | 'team' | 'relation' | 'remainder';
  value: string;
  visibleCount: number;
  hiddenCount: number;
  memberNodeIds: string[];
  label: string;
  withinDepth: boolean;
  aggregateScore: number;
  relationMix: Partial<Record<EdgeKind, number>>;
  evidenceIds: string[];
  hasChildren: boolean;
}

export type VisibleNode =
  | { kind: 'real'; id: string; node: SysNode; reason: InclusionReason; score: CandidateExplanation }
  | { kind: 'frontier'; id: string; frontier: FrontierGroup; reason: InclusionReason };

export type VisibleEdge =
  | { kind: 'real'; id: string; edge: SysEdge; source: string; target: string; canonicalEdgeIds: string[]; reason: InclusionReason; evidenceIds: string[] }
  | { kind: 'frontier-link'; id: string; source: string; target: string; canonicalEdgeIds: string[]; reason: InclusionReason; evidenceIds: string[] };

export interface ProjectionWarning {
  code: 'missing-root' | 'root-budget' | 'hard-budget' | 'missing-evidence' | 'evidence-disconnected';
  message: string;
}

export interface VisibleGraph {
  revision: string;
  projectionId: string;
  nodes: VisibleNode[];
  edges: VisibleEdge[];
  focalNodeId?: string;
  rootNodeIds: string[];
  warnings: ProjectionWarning[];
  retainedContext: Set<string>;
  stats: { candidates: number; visibleReal: number; visibleFrontiers: number; pruned: number };
}
