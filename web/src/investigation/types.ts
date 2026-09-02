import type { EdgeKind } from '../data/types';
import type { ProjectionDepth } from '../lib/graphProjection';

export type ProjectionId = string;
export type AbstractionLevel = 'service' | 'component' | 'package' | 'symbol';
export type EvidenceLevel = 'proven' | 'observed' | 'inferred';
export type RelationshipOverride = 'default' | 'include' | 'exclude';

export interface FrontierExpansion {
  pages: number;
  beyondDepth?: boolean;
}

export interface LockedPath {
  id: string;
  nodeIds: string[];
  edgeIds: string[];
}

export interface InvestigationState {
  contextKey: string;
  focalNodeId?: string;
  selectedEntity: { kind: 'node' | 'edge' | 'frontier'; id: string } | null;
  projectionId: ProjectionId;
  depth: { upstream: ProjectionDepth; downstream: ProjectionDepth };
  relationshipOverrides: Partial<Record<EdgeKind, RelationshipOverride>>;
  evidencePolicy: { maximumLevel: EvidenceLevel; includeStale: boolean };
  abstraction: AbstractionLevel;
  expandedFrontiers: Record<string, FrontierExpansion>;
  pinnedNodeIds: string[];
  lockedPath?: LockedPath;
  budget: { target: number; hard: number; allowLargeGraph: boolean };
}

export interface InvestigationDefaults {
  contextKey?: string;
  projectionId?: ProjectionId;
  upstreamDepth?: ProjectionDepth;
  downstreamDepth?: ProjectionDepth;
}

export function createInvestigationState(defaults: InvestigationDefaults = {}): InvestigationState {
  return {
    contextKey: defaults.contextKey ?? 'none',
    selectedEntity: null,
    projectionId: defaults.projectionId ?? 'dependencies',
    depth: { upstream: defaults.upstreamDepth ?? 1, downstream: defaults.downstreamDepth ?? 2 },
    relationshipOverrides: {},
    evidencePolicy: { maximumLevel: 'observed', includeStale: false },
    abstraction: 'symbol',
    expandedFrontiers: {},
    pinnedNodeIds: [],
    budget: { target: 30, hard: 40, allowLargeGraph: false },
  };
}
