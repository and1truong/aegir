import type { EvidenceRecord, SysEdge } from '../../data/types.ts';
import type { EvidencePolicy, GraphIndex } from '../types.ts';

const LEVEL = { proven: 0, observed: 1, inferred: 2 } as const;

export function evidenceSatisfies(record: EvidenceRecord, policy: EvidencePolicy, now = Date.now()) {
  if (LEVEL[record.strength] > LEVEL[policy.maximumLevel]) return false;
  if (!policy.includeStale && record.validUntil && Date.parse(record.validUntil) < now) return false;
  return true;
}

export function eligibleEvidenceIds(index: GraphIndex, edge: SysEdge, policy: EvidencePolicy, now = Date.now()) {
  return (index.evidenceBySubject.get(`edge:${edge.id}`) ?? []).filter((id) => {
    const record = index.evidenceById.get(id);
    return record ? evidenceSatisfies(record, policy, now) : false;
  });
}
