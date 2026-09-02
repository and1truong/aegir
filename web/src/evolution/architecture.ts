import type { GraphDelta, GraphEdgeDelta, GraphNodeDelta } from '../data/types';
import type { StructuralAnalytics } from '../analytics/structural';

export type EvolutionKind = 'dependency' | 'coupling' | 'boundary-density' | 'cycle' | 'ownership' | 'complexity' | 'test-protection';

export interface ArchitectureEvolutionChange {
  id: string;
  kind: EvolutionKind;
  direction: 'introduced' | 'removed' | 'increased' | 'decreased' | 'changed';
  title: string;
  detail: string;
  score: number;
  question: string;
  nodeIds: string[];
  edgeIds: string[];
  evidenceIds: string[];
}

function edgeChange(entry: GraphEdgeDelta): ArchitectureEvolutionChange | undefined {
  if (entry.status !== 'added' && entry.status !== 'removed') return undefined;
  const edge = entry.after ?? entry.before;
  if (!edge) return undefined;
  const introduced = entry.status === 'added';
  return {
    id: `dependency:${entry.id}:${entry.status}`,
    kind: 'dependency', direction: introduced ? 'introduced' : 'removed',
    title: `${introduced ? 'New' : 'Removed'} ${edge.kind} dependency`,
    detail: `${edge.source} → ${edge.target}`,
    score: introduced ? 90 : 65,
    question: introduced ? 'Does this new dependency expand the blast radius or cross a boundary?' : 'Was this dependency intentionally removed, and what replaces it?',
    nodeIds: [edge.source, edge.target], edgeIds: [edge.id], evidenceIds: [...new Set(entry.changeReasons.flatMap((reason) => reason.evidenceRefs ?? edge.evidenceRefs ?? []))],
  };
}

function reasonChanges(entry: GraphNodeDelta): ArchitectureEvolutionChange[] {
  const node = entry.after ?? entry.before;
  if (!node) return [];
  return entry.changeReasons.flatMap<ArchitectureEvolutionChange>((reason) => {
    const shared = { nodeIds: [entry.id], edgeIds: [] as string[], evidenceIds: reason.evidenceRefs ?? [] };
    if (reason.kind === 'ownership-changed') return [{ id: `ownership:${entry.id}`, kind: 'ownership' as const, direction: 'changed' as const, title: `Ownership boundary changed for ${node.label}`, detail: reason.detail, score: 80, question: 'Does the new owner or membership match the intended architecture?', ...shared }];
    if (reason.kind === 'complexity-changed') {
      const increase = /→\s*(\d+)/.exec(reason.detail);
      const before = /score\s*(\d+)/i.exec(reason.detail);
      const increased = Number(increase?.[1] ?? 0) > Number(before?.[1] ?? 0);
      return [{ id: `complexity:${entry.id}`, kind: 'complexity' as const, direction: increased ? 'increased' as const : 'decreased' as const, title: `Complexity ${increased ? 'increased' : 'changed'} for ${node.label}`, detail: reason.detail, score: increased ? 72 : 35, question: increased ? 'Should this change be split or protected by focused tests?' : 'Did the simplification preserve behavior?', ...shared }];
    }
    if (reason.kind === 'test-protection-changed') {
      const lost = /→\s*(uncovered|unknown|partial)/i.test(reason.detail);
      return [{ id: `test-protection:${entry.id}`, kind: 'test-protection' as const, direction: lost ? 'decreased' as const : 'changed' as const, title: `Test protection changed for ${node.label}`, detail: reason.detail, score: lost ? 88 : 45, question: lost ? 'Which changed paths are no longer protected by tests?' : 'Does the new test protection cover the changed behavior?', ...shared }];
    }
    return [];
  });
}

function cycleKey(nodeIds: readonly string[]) { return [...nodeIds].sort().join('|') }

export function analyzeArchitectureEvolution(input: { delta: GraphDelta; base: StructuralAnalytics; head: StructuralAnalytics }) {
  const comparable = input.base.scope.abstraction === input.head.scope.abstraction;
  const warnings = comparable ? [] : ['Structural metrics are not compared because base and head abstraction differ.'];
  const changes: ArchitectureEvolutionChange[] = input.delta.edges.flatMap((entry) => edgeChange(entry) ?? []).concat(input.delta.nodes.flatMap(reasonChanges));
  if (comparable) {
    const baseNodes = new Map(input.base.nodes.map((node) => [node.nodeId, node]));
    for (const after of input.head.nodes) {
      const before = baseNodes.get(after.nodeId);
      if (!before || before.coupling === after.coupling) continue;
      const increased = after.coupling > before.coupling;
      changes.push({ id: `coupling:${after.nodeId}`, kind: 'coupling', direction: increased ? 'increased' : 'decreased', title: `Coupling ${increased ? 'increased' : 'decreased'} for ${after.nodeId}`, detail: `${before.coupling} → ${after.coupling} distinct neighbors`, score: increased ? 68 : 30, question: increased ? 'Is the added coupling necessary, or should this boundary be refactored?' : 'Did decoupling preserve required behavior?', nodeIds: [after.nodeId], edgeIds: after.edgeIds, evidenceIds: after.evidenceIds });
    }
    const boundaryDelta = input.head.ownershipBoundaryDensity - input.base.ownershipBoundaryDensity;
    if (Math.abs(boundaryDelta) > 1e-9) changes.push({ id: 'boundary-density', kind: 'boundary-density', direction: boundaryDelta > 0 ? 'increased' : 'decreased', title: `Ownership-boundary density ${boundaryDelta > 0 ? 'increased' : 'decreased'}`, detail: `${Math.round(input.base.ownershipBoundaryDensity * 100)}% → ${Math.round(input.head.ownershipBoundaryDensity * 100)}%`, score: boundaryDelta > 0 ? 75 : 32, question: 'Which cross-team relationships explain this boundary change?', nodeIds: [], edgeIds: [], evidenceIds: [] });
    const baseCycles = new Map(input.base.cycles.map((cycle) => [cycleKey(cycle.nodeIds), cycle]));
    const headCycles = new Map(input.head.cycles.map((cycle) => [cycleKey(cycle.nodeIds), cycle]));
    for (const [key, cycle] of headCycles) if (!baseCycles.has(key)) changes.push({ id: `cycle:${key}:introduced`, kind: 'cycle', direction: 'introduced', title: 'Dependency cycle introduced', detail: cycle.nodeIds.join(' → '), score: 100, question: 'Which new relationship closes this cycle, and can it be inverted?', nodeIds: cycle.nodeIds, edgeIds: cycle.edgeIds, evidenceIds: [] });
    for (const [key, cycle] of baseCycles) if (!headCycles.has(key)) changes.push({ id: `cycle:${key}:removed`, kind: 'cycle', direction: 'removed', title: 'Dependency cycle removed', detail: cycle.nodeIds.join(' → '), score: 40, question: 'Was the cycle removal intentional and behavior-preserving?', nodeIds: cycle.nodeIds, edgeIds: cycle.edgeIds, evidenceIds: [] });
  }
  const deduped = [...new Map(changes.map((change) => [change.id, change])).values()].sort((left, right) => right.score - left.score || left.id.localeCompare(right.id));
  return { version: 1 as const, comparable, warnings, changes: deduped };
}
