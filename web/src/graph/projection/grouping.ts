import type { EdgeKind } from '../../data/types';
import type { FrontierGroup, GraphIndex, GroupingDimensionId, ProjectionDirection } from '../types';
import { groupingValue } from './groupingDimensions.ts';

export interface GroupCandidate {
  nodeId: string;
  relation: EdgeKind;
  score: number;
  evidenceIds: string[];
  withinDepth: boolean;
}

interface GroupingOptions {
  parentId: string;
  parentFrontierId?: string;
  direction: ProjectionDirection;
  category: string;
  dimensions?: readonly GroupingDimensionId[];
  maxGroups?: number;
}

function labelFor(index: GraphIndex, value: string, count: number) {
  const entity = index.nodeById.get(value);
  const name = entity?.label ?? (value === 'ungrouped' ? 'Other' : value);
  return `${name} · ${count}`;
}

function createGroup(index: GraphIndex, candidates: GroupCandidate[], options: GroupingOptions, dimension: FrontierGroup['dimension'], value: string): FrontierGroup {
  const relationMix: Partial<Record<EdgeKind, number>> = {};
  const evidence = new Set<string>();
  for (const candidate of candidates) {
    relationMix[candidate.relation] = (relationMix[candidate.relation] ?? 0) + 1;
    candidate.evidenceIds.forEach((id) => evidence.add(id));
  }
  const id = `frontier:${options.direction}:${encodeURIComponent(options.parentId)}:${options.parentFrontierId ? `${encodeURIComponent(options.parentFrontierId)}:` : ''}${dimension}:${encodeURIComponent(value)}`;
  return {
    id,
    parentId: options.parentId,
    parentFrontierId: options.parentFrontierId,
    direction: options.direction,
    category: options.category,
    dimension,
    value,
    visibleCount: 0,
    hiddenCount: candidates.length,
    memberNodeIds: candidates.map((candidate) => candidate.nodeId).sort(),
    label: dimension === 'remainder' ? `Remainder · ${candidates.length}` : labelFor(index, value, candidates.length),
    withinDepth: candidates.every((candidate) => candidate.withinDepth),
    aggregateScore: Math.max(...candidates.map((candidate) => candidate.score), 0) + Math.log1p(candidates.length) * 0.25,
    relationMix,
    evidenceIds: [...evidence].sort(),
    hasChildren: dimension === 'service' || dimension === 'package' || candidates.length > 1,
  };
}

export function groupFrontierCandidates(index: GraphIndex, candidates: GroupCandidate[], options: GroupingOptions): FrontierGroup[] {
  if (candidates.length === 0) return [];
  const dimensions = options.dimensions ?? ['service', 'package', 'relation'];
  const dimension = dimensions.find((candidateDimension) => candidates.some((candidate) => groupingValue(candidateDimension, index, candidate))) ?? 'relation';
  const buckets = new Map<string, GroupCandidate[]>();
  for (const candidate of candidates) {
    const value = groupingValue(dimension, index, candidate) ?? 'ungrouped';
    buckets.set(value, [...(buckets.get(value) ?? []), candidate]);
  }
  const ranked = [...buckets.entries()]
    .map(([value, members]) => createGroup(index, members, options, dimension, value))
    .sort((left, right) => right.aggregateScore - left.aggregateScore || left.value.localeCompare(right.value) || left.id.localeCompare(right.id));
  const maxGroups = Math.max(2, options.maxGroups ?? 6);
  if (ranked.length <= maxGroups) return ranked;
  const kept = ranked.slice(0, maxGroups - 1);
  const remainderIds = new Set(ranked.slice(maxGroups - 1).flatMap((group) => group.memberNodeIds));
  const remainderCandidates = candidates.filter((candidate) => remainderIds.has(candidate.nodeId));
  return [...kept, createGroup(index, remainderCandidates, options, 'remainder', 'remainder')];
}
