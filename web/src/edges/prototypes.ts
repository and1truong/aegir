import type { Boundary, EdgeKind, SysEdge } from '../data/types.ts';

export type EdgePrototypeStage = 1 | 2 | 3 | 4 | 5;
export type EdgePortFamily = 'control' | 'data' | 'async' | 'ownership';

export const edgePrototypeStages: ReadonlyArray<{ id: EdgePrototypeStage; label: string }> = [
  { id: 1, label: 'Selective labels' },
  { id: 2, label: 'Semantic ports' },
  { id: 3, label: 'Shared path trunks' },
  { id: 4, label: 'Relation lanes' },
  { id: 5, label: 'Aggregate bundles' },
];

export interface EdgePrototypeContext {
  selectedEdgeId?: string;
  pathEdgeIds?: ReadonlySet<string>;
  deltaEdgeIds?: ReadonlySet<string>;
  labels?: Readonly<Record<string, string>>;
}

export interface EdgePrototypePresentation {
  edgeId: string;
  showLabel: boolean;
  label?: string;
  labelReason?: 'selected' | 'path' | 'delta';
  sourcePort: { family: EdgePortFamily; handle: string };
  targetPort: { family: EdgePortFamily; handle: string };
  pathHighlighted: boolean;
  trunkId?: string;
  trunkRole?: 'source' | 'target';
  lane: number;
  routing: 'bezier' | 'trunk' | 'orthogonal';
  bundle?: { count: number; canonicalEdgeIds: string[]; evidenceRefs: string[] };
}

export interface PositionedEdgeNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EdgePrototypeMetrics {
  crossingCount: { baseline: number; prototype: number };
  directionRecognition: number;
  clickAccuracy: number;
  focalPathComprehension: number;
  layoutTimeMs: number;
  routingDecision: 'retain-dagre' | 'evaluate-elk';
}

export function routingDecision(input: { stage: EdgePrototypeStage; baselineCrossings: number; prototypeCrossings: number; directionRecognition: number; clickAccuracy: number; focalPathComprehension: number; layoutTimeMs: number }): EdgePrototypeMetrics['routingDecision'] {
  const crossingImprovement = input.baselineCrossings > 0 ? (input.baselineCrossings - input.prototypeCrossings) / input.baselineCrossings : 0;
  const materialBenefit = input.stage === 5 && input.baselineCrossings >= 4 && crossingImprovement >= 0.25 && input.directionRecognition >= 0.9 && input.clickAccuracy >= 0.9 && input.focalPathComprehension >= 0.9 && input.layoutTimeMs <= 50;
  return materialBenefit ? 'evaluate-elk' : 'retain-dagre';
}

const laneByFamily: Record<EdgePortFamily, number> = { control: 0, data: 1, async: 2, ownership: 3 };

function portFamily(kind: EdgeKind, boundary?: Boundary): EdgePortFamily {
  if (boundary === 'async' || kind === 'publishes' || kind === 'consumes') return 'async';
  if (boundary === 'persistence' || kind === 'reads' || kind === 'writes' || kind === 'transforms') return 'data';
  if (kind === 'owns' || kind === 'implements' || kind === 'tests') return 'ownership';
  return 'control';
}

function handles(family: EdgePortFamily) {
  if (family === 'data') return { source: 'data-out', target: 'data-in' };
  if (family === 'async') return { source: 'async-out', target: 'async-in' };
  if (family === 'ownership') return { source: 'ownership-out', target: 'ownership-in' };
  return { source: 'control-out', target: 'control-in' };
}

function trueAggregate(edge: SysEdge) {
  const canonicalEdgeIds = [...new Set(edge.canonicalEdgeIds ?? [])].sort();
  if ((edge.underlyingCount ?? 1) <= 1 || canonicalEdgeIds.length <= 1) return undefined;
  return {
    count: edge.underlyingCount!,
    canonicalEdgeIds,
    evidenceRefs: [...new Set(edge.evidenceRefs ?? [])].sort(),
  };
}

export function buildEdgePrototype(edges: readonly SysEdge[], stage: EdgePrototypeStage, context: EdgePrototypeContext = {}): Map<string, EdgePrototypePresentation> {
  const pathIds = context.pathEdgeIds ?? new Set<string>();
  const deltaIds = context.deltaEdgeIds ?? new Set<string>();
  const pathIncident = new Map<string, string[]>();
  for (const edge of edges) {
    if (!pathIds.has(edge.id)) continue;
    for (const nodeId of [edge.source, edge.target]) pathIncident.set(nodeId, [...(pathIncident.get(nodeId) ?? []), edge.id]);
  }
  const sharedTrunkByEdge = new Map<string, { id: string; role: 'source' | 'target' }>();
  if (stage >= 3) {
    for (const [nodeId, edgeIds] of pathIncident) {
      const unique = [...new Set(edgeIds)].sort();
      if (unique.length < 2) continue;
      const trunkId = `path-trunk:${nodeId}:${unique.join(',')}`;
      for (const edgeId of unique) {
        const edge = edges.find((candidate) => candidate.id === edgeId)!;
        if (!sharedTrunkByEdge.has(edgeId)) sharedTrunkByEdge.set(edgeId, { id: trunkId, role: edge.source === nodeId ? 'source' : 'target' });
      }
    }
  }

  return new Map(edges.map((edge) => {
    const family = portFamily(edge.kind, edge.boundary);
    const portHandles = handles(family);
    const labelReason = edge.id === context.selectedEdgeId ? 'selected' : pathIds.has(edge.id) ? 'path' : deltaIds.has(edge.id) ? 'delta' : undefined;
    const baseLabel = context.labels?.[edge.id] ?? edge.label ?? edge.transform ?? edge.kind;
    const bundle = stage >= 5 ? trueAggregate(edge) : undefined;
    const trunk = sharedTrunkByEdge.get(edge.id);
    const presentation: EdgePrototypePresentation = {
      edgeId: edge.id,
      showLabel: Boolean(labelReason),
      label: labelReason ? `${baseLabel}${bundle ? ` ×${bundle.count}` : ''}` : undefined,
      labelReason,
      sourcePort: { family, handle: portHandles.source },
      targetPort: { family, handle: portHandles.target },
      pathHighlighted: pathIds.has(edge.id),
      trunkId: trunk?.id,
      trunkRole: trunk?.role,
      lane: stage >= 4 ? laneByFamily[family] : 0,
      routing: stage >= 4 ? 'orthogonal' : trunk ? 'trunk' : 'bezier',
      bundle,
    };
    return [edge.id, presentation];
  }));
}

type Point = { x: number; y: number };
type Segment = { edgeId: string; a: Point; b: Point; source: string; target: string };

function center(node: PositionedEdgeNode): Point {
  return { x: node.x + node.width / 2, y: node.y + node.height / 2 };
}

function segmentsFor(edges: readonly SysEdge[], positions: ReadonlyMap<string, PositionedEdgeNode>, presentations: ReadonlyMap<string, EdgePrototypePresentation>, prototype: boolean): Segment[] {
  return edges.flatMap((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return [];
    const a = center(source);
    const b = center(target);
    const presentation = presentations.get(edge.id);
    if (!prototype || presentation?.routing !== 'orthogonal') return [{ edgeId: edge.id, a, b, source: edge.source, target: edge.target }];
    const laneOffset = presentation.lane * 8;
    const middleX = (a.x + b.x) / 2 + laneOffset;
    const points = [a, { x: middleX, y: a.y }, { x: middleX, y: b.y }, b];
    return points.slice(0, -1).map((point, index) => ({ edgeId: edge.id, a: point, b: points[index + 1], source: edge.source, target: edge.target }));
  });
}

function orientation(a: Point, b: Point, c: Point) {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function intersects(first: Segment, second: Segment) {
  if (first.edgeId === second.edgeId || first.source === second.source || first.source === second.target || first.target === second.source || first.target === second.target) return false;
  const o1 = orientation(first.a, first.b, second.a);
  const o2 = orientation(first.a, first.b, second.b);
  const o3 = orientation(second.a, second.b, first.a);
  const o4 = orientation(second.a, second.b, first.b);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

function crossingCount(segments: readonly Segment[]) {
  let count = 0;
  for (let left = 0; left < segments.length; left++) for (let right = left + 1; right < segments.length; right++) if (intersects(segments[left], segments[right])) count++;
  return count;
}

export function measureEdgePrototype(input: {
  edges: readonly SysEdge[];
  positions: ReadonlyMap<string, PositionedEdgeNode>;
  presentations: ReadonlyMap<string, EdgePrototypePresentation>;
  stage: EdgePrototypeStage;
  layoutTimeMs: number;
  hitTargetWidth?: number;
}): EdgePrototypeMetrics {
  const baseline = crossingCount(segmentsFor(input.edges, input.positions, input.presentations, false));
  const prototype = crossingCount(segmentsFor(input.edges, input.positions, input.presentations, true));
  const values = [...input.presentations.values()];
  const semanticPorts = input.stage >= 2 ? values.filter((item) => item.sourcePort.family === item.targetPort.family).length : 0;
  const focusEdges = values.filter((item) => item.labelReason === 'selected' || item.pathHighlighted);
  const understood = focusEdges.filter((item) => item.showLabel && (item.labelReason === 'selected' || item.pathHighlighted)).length;
  const directionRecognition = values.length ? semanticPorts / values.length : 1;
  const clickAccuracy = (input.hitTargetWidth ?? 20) >= 16 ? 1 : (input.hitTargetWidth ?? 20) / 16;
  const focalPathComprehension = focusEdges.length ? understood / focusEdges.length : 1;
  return {
    crossingCount: { baseline, prototype },
    directionRecognition,
    clickAccuracy,
    focalPathComprehension,
    layoutTimeMs: input.layoutTimeMs,
    routingDecision: routingDecision({ stage: input.stage, baselineCrossings: baseline, prototypeCrossings: prototype, directionRecognition, clickAccuracy, focalPathComprehension, layoutTimeMs: input.layoutTimeMs }),
  };
}
