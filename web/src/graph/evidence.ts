import type { EvidenceRecord, SysEdge } from '../data/types';
import type { GraphIndex } from './types';

export function evidenceForEdge(index: GraphIndex, edge: SysEdge): EvidenceRecord[] {
  return (index.evidenceBySubject.get(`edge:${edge.id}`) ?? []).flatMap((id) => {
    const record = index.evidenceById.get(id);
    return record ? [record] : [];
  });
}

export function formatEvidenceLocation(record: EvidenceRecord) {
  if (!record.location) return undefined;
  return record.location.line ? `${record.location.file}:${record.location.line}` : record.location.file;
}
