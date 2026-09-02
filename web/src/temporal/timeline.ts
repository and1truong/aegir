import type { EvidenceRecord, GraphDelta, SysEdge, SysNode } from '../data/types';

export interface SnapshotRef {
  version: 1;
  repositoryId: string;
  snapshotId: number;
  commit?: string;
  createdAt: string;
  kind: 'index' | 'review';
  fingerprint: string;
  storageBytes: number;
}

export interface TemporalReview {
  id: string;
  createdAt: string;
  baseRef: string;
  headRef: string;
  baseSnapshotId: number;
  headSnapshotId: number;
  delta: GraphDelta;
}

export interface Timeline {
  version: 1;
  snapshots: SnapshotRef[];
  reviews: TemporalReview[];
}

export interface GraphState { nodes: SysNode[]; edges: SysEdge[] }

export function reconstructGraph(base: GraphState, deltas: readonly GraphDelta[]): GraphState {
  const nodes = new Map(base.nodes.map((node) => [node.id, { ...node }]));
  const edges = new Map(base.edges.map((edge) => [edge.id, { ...edge }]));
  for (const delta of deltas) {
    for (const entry of [...delta.nodes].sort((left, right) => left.id.localeCompare(right.id))) {
      if (entry.status === 'removed') nodes.delete(entry.id);
      else if (entry.after) nodes.set(entry.id, { ...entry.after });
    }
    for (const entry of [...delta.edges].sort((left, right) => left.id.localeCompare(right.id))) {
      if (entry.status === 'removed') edges.delete(entry.id);
      else if (entry.after) edges.set(entry.id, { ...entry.after });
    }
  }
  return {
    nodes: [...nodes.values()].sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...edges.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

export function resolveSnapshotPair(timeline: Timeline, reviewId: string) {
  const review = timeline.reviews.find((item) => item.id === reviewId);
  if (!review) return { error: 'Review is missing from this timeline.' } as const;
  const base = timeline.snapshots.find((item) => item.snapshotId === review.baseSnapshotId);
  const head = timeline.snapshots.find((item) => item.snapshotId === review.headSnapshotId);
  if (!base || !head) return { error: `Snapshot ${!base ? review.baseSnapshotId : review.headSnapshotId} is unavailable.` } as const;
  return { review, base, head } as const;
}

export type EvidenceValidity = 'valid' | 'stale' | 'future' | 'unscoped';

export function evidenceValidity(record: EvidenceRecord, snapshot: SnapshotRef, at = snapshot.createdAt): EvidenceValidity {
  if (record.snapshotId !== undefined && record.snapshotId > snapshot.snapshotId) return 'future';
  if (record.snapshotId !== undefined && record.snapshotId < snapshot.snapshotId) return 'stale';
  if (record.commit && snapshot.commit && record.commit !== snapshot.commit) return 'stale';
  if (record.validUntil && Date.parse(record.validUntil) < Date.parse(at)) return 'stale';
  if (record.snapshotId === undefined && !record.commit && !record.validUntil) return 'unscoped';
  return 'valid';
}

export function dependencyIntroduction(edgeId: string, timeline: Timeline) {
  const snapshotById = new Map(timeline.snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]));
  return [...timeline.reviews]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.headSnapshotId - right.headSnapshotId || left.id.localeCompare(right.id))
    .flatMap((review) => review.delta.edges.filter((edge) => edge.id === edgeId && edge.status === 'added').map(() => ({ review, snapshot: snapshotById.get(review.headSnapshotId) })))
    .find((item) => item.snapshot);
}

export function profileSnapshotStorage(snapshots: readonly SnapshotRef[]) {
  const totalBytes = snapshots.reduce((sum, snapshot) => sum + snapshot.storageBytes, 0);
  const averageBytes = snapshots.length ? Math.round(totalBytes / snapshots.length) : 0;
  const recommendation = snapshots.length <= 20 && averageBytes <= 25 * 1024 * 1024 ? 'full-snapshots' : 'checkpoint-deltas';
  return { count: snapshots.length, totalBytes, averageBytes, recommendation } as const;
}
