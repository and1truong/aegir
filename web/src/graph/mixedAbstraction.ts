import type { EvidenceRecord, SysEdge } from '../data/types.ts';
import type { AbstractionLevel } from '../investigation/types.ts';
import { createGraphIndex } from './index.ts';
import { abstractGraph, type AbstractGraph } from './abstraction.ts';
import type { GraphIndex } from './types.ts';

const nextLevel: Partial<Record<AbstractionLevel, AbstractionLevel>> = {
  service: 'component',
  component: 'package',
  package: 'symbol',
};

export interface MixedAbstractionGraph extends AbstractGraph {
  experimental: true;
  branch?: { globalRepresentativeId: string; globalLevel: AbstractionLevel; detailLevel: AbstractionLevel };
}

export function mixedAbstractionGraph(index: GraphIndex, globalLevel: AbstractionLevel, focalCanonicalId?: string): MixedAbstractionGraph {
  const global = abstractGraph(index, globalLevel);
  const detailLevel = nextLevel[globalLevel];
  const branchId = focalCanonicalId ? global.canonicalToRepresentative.get(focalCanonicalId) : undefined;
  if (!detailLevel || !branchId) return { ...global, experimental: true };
  const detail = abstractGraph(index, detailLevel);
  const mapping = new Map<string, string>();
  const levelByRepresentative = new Map<string, AbstractionLevel>();
  for (const node of index.nodes) {
    const globalRepresentative = global.canonicalToRepresentative.get(node.id)!;
    const detailed = globalRepresentative === branchId;
    const representative = detailed ? detail.canonicalToRepresentative.get(node.id)! : globalRepresentative;
    mapping.set(node.id, representative);
    levelByRepresentative.set(representative, detailed ? detailLevel : globalLevel);
  }
  const nodeMembers = new Map<string, string[]>();
  for (const [canonical, representative] of mapping) nodeMembers.set(representative, [...(nodeMembers.get(representative) ?? []), canonical]);
  const nodes = [...nodeMembers].flatMap(([id, members]) => {
    const body = index.nodeById.get(id);
    return body ? [{ ...body, representedNodeIds: members.sort(), abstractionLevel: levelByRepresentative.get(id) }] : [];
  }).sort((left, right) => left.id.localeCompare(right.id));
  const groups = new Map<string, SysEdge[]>();
  for (const edge of index.edges) {
    const source = mapping.get(edge.source);
    const target = mapping.get(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}|${edge.kind}|${target}`;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const edgeMembers = new Map<string, string[]>();
  const evidence: EvidenceRecord[] = [];
  const edges = [...groups].sort(([left], [right]) => left.localeCompare(right)).map(([key, members]) => {
    const first = members[0];
    const canonicalEdgeIds = members.map((edge) => edge.id).sort();
    const id = `mixed:${globalLevel}:${detailLevel}:${key}`;
    edgeMembers.set(id, canonicalEdgeIds);
    const evidenceRefs: string[] = [];
    for (const canonicalEdgeId of canonicalEdgeIds) {
      for (const evidenceId of index.evidenceBySubject.get(`edge:${canonicalEdgeId}`) ?? []) {
        const record = index.evidenceById.get(evidenceId);
        if (!record) continue;
        const representativeEvidenceId = `${id}:${record.id}`;
        if (evidenceRefs.includes(representativeEvidenceId)) continue;
        evidenceRefs.push(representativeEvidenceId);
        evidence.push({ ...record, id: representativeEvidenceId, subject: { kind: 'edge', id } });
      }
    }
    return { ...first, id, source: mapping.get(first.source)!, target: mapping.get(first.target)!, label: members.length > 1 ? `contains ${members.length} underlying relationships` : first.label, evidenceRefs, canonicalEdgeIds, underlyingCount: members.length };
  });
  return {
    index: createGraphIndex(nodes, edges, evidence),
    canonicalToRepresentative: mapping,
    representativeNodeMembers: nodeMembers,
    representativeEdgeMembers: edgeMembers,
    experimental: true,
    branch: { globalRepresentativeId: branchId, globalLevel, detailLevel },
  };
}
