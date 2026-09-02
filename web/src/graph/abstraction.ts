import type { EvidenceRecord, SysEdge, SysNode } from '../data/types.ts';
import { createGraphIndex } from './index.ts';
import type { GraphIndex } from './types.ts';
import type { AbstractionLevel } from '../investigation/types.ts';

function representativeId(index: GraphIndex, node: SysNode, level: AbstractionLevel) {
  if (level === 'symbol') return node.id;
  if (level === 'service') return node.kind === 'service' ? node.id : node.service && index.nodeById.has(node.service) ? node.service : node.id;
  if (level === 'component') {
    const component = typeof node.meta?.component === 'string' ? node.meta.component : undefined;
    if (component && index.nodeById.has(component)) return component;
  }
  return node.kind === 'package' || node.kind === 'service' ? node.id : node.pkg && index.nodeById.has(node.pkg) ? node.pkg : node.id;
}

export interface AbstractGraph {
  index: GraphIndex;
  canonicalToRepresentative: ReadonlyMap<string, string>;
  representativeNodeMembers: ReadonlyMap<string, readonly string[]>;
  representativeEdgeMembers: ReadonlyMap<string, readonly string[]>;
}

export function abstractGraph(index: GraphIndex, level: AbstractionLevel): AbstractGraph {
  const canonicalToRepresentative = new Map(index.nodes.map((node) => [node.id, representativeId(index, node, level)]));
  const nodeMembers = new Map<string, string[]>();
  for (const [canonical, representative] of canonicalToRepresentative) nodeMembers.set(representative, [...(nodeMembers.get(representative) ?? []), canonical]);
  const nodes = [...nodeMembers].flatMap(([id, members]) => {
    const body = index.nodeById.get(id);
    return body ? [{ ...body, representedNodeIds: members.sort(), abstractionLevel: level }] : [];
  }).sort((a, b) => a.id.localeCompare(b.id));

  const groups = new Map<string, SysEdge[]>();
  for (const edge of index.edges) {
    const source = canonicalToRepresentative.get(edge.source);
    const target = canonicalToRepresentative.get(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}|${edge.kind}|${target}`;
    groups.set(key, [...(groups.get(key) ?? []), edge]);
  }
  const edgeMembers = new Map<string, string[]>();
  const evidence: EvidenceRecord[] = [];
  const edges = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, members]) => {
    const first = members[0];
    const id = level === 'symbol' && members.length === 1 ? first.id : `abstract:${level}:${key}`;
    const canonicalEdgeIds = members.map((edge) => edge.id).sort();
    const evidenceRefs = [...new Set(members.flatMap((edge) => index.evidenceBySubject.get(`edge:${edge.id}`) ?? []))].sort();
    const representativeEvidenceIds: string[] = [];
    edgeMembers.set(id, canonicalEdgeIds);
    for (const evidenceId of evidenceRefs) {
      const record = index.evidenceById.get(evidenceId);
      if (record) {
        const representativeEvidenceId = `${id}:${record.id}`;
        representativeEvidenceIds.push(representativeEvidenceId);
        evidence.push({ ...record, id: representativeEvidenceId, subject: { kind: 'edge', id } });
      }
    }
    return { ...first, id, source: canonicalToRepresentative.get(first.source)!, target: canonicalToRepresentative.get(first.target)!, label: members.length > 1 ? `contains ${members.length} underlying relationships` : first.label, evidenceRefs: representativeEvidenceIds, canonicalEdgeIds, underlyingCount: members.length };
  });
  return {
    index: createGraphIndex(nodes, edges, evidence, { telemetry: [...index.telemetryByNode].flatMap(([nodeId, telemetry]) => { const representative = canonicalToRepresentative.get(nodeId); return representative ? [{ nodeId: representative, ...telemetry }] : [] }), findingNodeIds: [...index.findingNodeIds].flatMap((id) => canonicalToRepresentative.get(id) ?? []) }),
    canonicalToRepresentative,
    representativeNodeMembers: nodeMembers,
    representativeEdgeMembers: edgeMembers,
  };
}
