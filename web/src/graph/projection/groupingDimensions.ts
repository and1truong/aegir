import type { GroupingDimensionId, GraphIndex } from '../types.ts';
import type { GroupCandidate } from './grouping.ts';

interface GroupingDimension {
  id: GroupingDimensionId;
  label: string;
  value: (index: GraphIndex, candidate: GroupCandidate) => string | undefined;
}

export const groupingDimensions: Record<GroupingDimensionId, GroupingDimension> = {
  service: { id: 'service', label: 'Service', value: (index, candidate) => index.membership.get(candidate.nodeId)?.service },
  package: { id: 'package', label: 'Package', value: (index, candidate) => index.membership.get(candidate.nodeId)?.pkg },
  team: { id: 'team', label: 'Team', value: (index, candidate) => index.membership.get(candidate.nodeId)?.owner },
  relation: { id: 'relation', label: 'Relationship', value: (_, candidate) => candidate.relation },
  topic: { id: 'topic', label: 'Topic', value: (index, candidate) => index.nodeById.get(candidate.nodeId)?.kind === 'topic' ? candidate.nodeId : ['publishes', 'consumes'].includes(candidate.relation) ? candidate.relation : undefined },
  access: { id: 'access', label: 'Access', value: (_, candidate) => ['reads', 'writes'].includes(candidate.relation) ? candidate.relation : undefined },
  traffic: { id: 'traffic', label: 'Traffic', value: (index, candidate) => { const telemetry = index.telemetryByNode.get(candidate.nodeId); const load = telemetry?.rpm ?? telemetry?.qps; return load === undefined ? undefined : load >= 1000 ? 'high' : load >= 100 ? 'medium' : 'low' } },
};

export function groupingValue(id: GroupingDimensionId, index: GraphIndex, candidate: GroupCandidate) {
  return groupingDimensions[id].value(index, candidate);
}
