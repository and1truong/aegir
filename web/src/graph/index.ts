import type { EvidenceRecord, SysEdge, SysNode } from '../data/types';
import type { GraphIndex } from './types';

function append(map: Map<string, string[]>, id: string, edgeId: string) {
  const values = map.get(id) ?? [];
  values.push(edgeId);
  map.set(id, values);
}

export function createGraphIndex(nodes: readonly SysNode[], edges: readonly SysEdge[], evidence: readonly EvidenceRecord[] = []): GraphIndex {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edgeById = new Map<string, SysEdge>();
  const incomingByNode = new Map<string, string[]>();
  const outgoingByNode = new Map<string, string[]>();
  const adjacentByNode = new Map<string, string[]>();
  const evidenceById = new Map(evidence.map((record) => [record.id, record]));
  const evidenceBySubject = new Map<string, string[]>();

  for (const record of evidence) append(evidenceBySubject, `${record.subject.kind}:${record.subject.id}`, record.id);

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    edgeById.set(edge.id, edge);
    append(outgoingByNode, edge.source, edge.id);
    append(incomingByNode, edge.target, edge.id);
    append(adjacentByNode, edge.source, edge.id);
    if (edge.target !== edge.source) append(adjacentByNode, edge.target, edge.id);
    if ((evidenceBySubject.get(`edge:${edge.id}`)?.length ?? 0) === 0) {
      const id = `legacy:${edge.id}`;
      const fallback: EvidenceRecord = { id, source: 'INFERRED', strength: 'inferred', subject: { kind: 'edge', id: edge.id }, summary: edge.label ? `Legacy relationship: ${edge.label}` : 'Legacy relationship; re-index for exact source evidence.' };
      evidenceById.set(id, fallback);
      append(evidenceBySubject, `edge:${edge.id}`, id);
    }
  }

  const sort = (map: Map<string, string[]>) => {
    for (const values of map.values()) values.sort((a, b) => {
      const left = edgeById.get(a)!;
      const right = edgeById.get(b)!;
      return left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id);
    });
  };
  sort(incomingByNode);
  sort(outgoingByNode);
  sort(adjacentByNode);

  return {
    nodes: [...nodes],
    edges: [...edgeById.values()],
    nodeById,
    edgeById,
    incomingByNode,
    outgoingByNode,
    adjacentByNode,
    membership: new Map(nodes.map((node) => [node.id, { service: node.service, pkg: node.pkg, owner: node.owner }])),
    evidenceById,
    evidenceBySubject,
  };
}
