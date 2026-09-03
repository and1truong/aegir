export interface AttentionEvidenceRef { kind: string; id: string }

export interface AttentionFactor {
  id: string;
  label: string;
  rawValue: number;
  displayValue: string;
  normalized: number;
  weight: number;
  contribution: number;
  status: 'observed' | 'unavailable' | 'excluded';
  evidenceRefs: AttentionEvidenceRef[];
}

export interface AttentionDimension {
  score: number | null;
  coverage: number;
  factors: AttentionFactor[];
}

export interface AttentionUnit {
  unit: { id: string; label: string; path?: string; kind: 'package'; team?: string; teams?: string[]; subsystem?: string };
  impact: AttentionDimension;
  changeComplexity: AttentionDimension;
  changeVelocity: AttentionDimension;
  priority: number;
  region: 'investigate' | 'protect' | 'simplify' | 'low-attention';
  memberCount: number;
}

export interface AttentionFinding {
  id: string;
  unitId: string;
  priority: number;
  region: AttentionUnit['region'];
  title: string;
  explanation: string;
  dominantFactors: string[];
  evidenceRefs: AttentionEvidenceRef[];
}

export interface AttentionLandscape {
  version: 1;
  modelVersion: string;
  calculatedAt: string;
  snapshotId: number;
  repositoryId: string;
  unitLevel: 'package';
  windowDays: number;
  policy: { id: string; impactHigh: number; complexityHigh: number; velocityFast: number; maximumFindings: number; minimumFindingPriority: number };
  completeness: { historyAvailable: boolean; historyShallow: boolean; optionalSignals: string[]; warnings: string[] };
  units: AttentionUnit[];
  findings: AttentionFinding[];
}

export interface AttentionEvidenceBundle {
  unit: AttentionUnit;
  graphEdges: { id: string; source: string; target: string; kind: string; label?: string; evidenceRefs: string[] }[];
  sourceEvidence: { id: string; source: string; strength: string; summary: string; location?: { file: string; line?: number } }[];
  gitChanges: { id: string; commit: string; summary?: string; occurredAt: string; authorKey: string; refactorNoise?: boolean; files: { path: string; oldPath?: string; additions: number; deletions: number; generated?: boolean; excluded?: boolean; rename?: boolean }[] }[];
}

export interface ReviewAttentionUnit {
  unit: AttentionUnit;
  touched: boolean;
  focalNodeId?: string;
  changeStatuses: string[];
  changedNodes: number;
  changedRelationships: number;
  reviewPriority: number;
}

export interface ReviewAttention {
  version: 1;
  reviewId: string;
  baseline: AttentionLandscape;
  units: ReviewAttentionUnit[];
  touchedUnits: number;
  highAttentionUnits: number;
  newNodes: number;
  newRelationships: number;
  summary: string;
}
