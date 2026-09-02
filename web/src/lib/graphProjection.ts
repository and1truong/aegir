import type { EdgeKind, SysEdge, SysNode } from '../data/types';
import { createGraphIndex } from '../graph/index.ts';
import { projectionDefinition } from '../graph/projection/definitions.ts';
import { frontierId, projectVisibleGraph, type FrontierExpansions } from '../graph/projection/engine.ts';
import type { GraphIndex, ProjectionDepth, VisibleGraph } from '../graph/types';

export type { ProjectionDepth } from '../graph/types';
export type ProjectionDirection = 'upstream' | 'downstream';
export type BranchExpansions = FrontierExpansions;

export interface GraphProjectionOptions {
  projectionId?: string;
  activeNodeId?: string;
  rootNodeIds?: string[];
  upstreamDepth?: ProjectionDepth;
  downstreamDepth?: ProjectionDepth;
  edgeKinds?: ReadonlySet<EdgeKind>;
  branchExpansions?: BranchExpansions;
  nodeBudget?: number;
  branchLimit?: number;
  branchPageSize?: number;
}

export interface FrontierAggregate {
  nodeId: string;
  branchKey: string;
  parentId: string;
  direction: ProjectionDirection;
  hiddenCount: number;
  label: string;
  withinDepth: boolean;
}

export interface GraphProjection {
  nodes: SysNode[];
  edges: SysEdge[];
  aggregates: FrontierAggregate[];
  rootNodeIds: string[];
  retainedContext: Set<string>;
  visibleGraph: VisibleGraph;
}

export function branchKey(parentId: string, direction: ProjectionDirection, category: string) {
  return frontierId(parentId, direction, category);
}

export function isAggregateNode(id: string) {
  return id.startsWith('aggregate:');
}

function aggregateNodeId(id: string) {
  return `aggregate:${encodeURIComponent(id)}`;
}

function compatibilityProjection(visibleGraph: VisibleGraph): GraphProjection {
  const realNodes = visibleGraph.nodes.flatMap((item) => item.kind === 'real' ? [item.node] : []);
  const frontiers = visibleGraph.nodes.flatMap((item) => item.kind === 'frontier' ? [item.frontier] : []);
  const aggregates: FrontierAggregate[] = frontiers.map((frontier) => ({
    nodeId: aggregateNodeId(frontier.id),
    branchKey: frontier.id,
    parentId: frontier.parentId,
    direction: frontier.direction,
    hiddenCount: frontier.hiddenCount,
    label: frontier.label,
    withinDepth: frontier.withinDepth,
  }));
  const realEdges = visibleGraph.edges.flatMap((item) => item.kind === 'real' ? [item.edge] : []);
  return {
    nodes: realNodes,
    edges: realEdges,
    aggregates,
    rootNodeIds: visibleGraph.rootNodeIds,
    retainedContext: visibleGraph.retainedContext,
    visibleGraph,
  };
}

export function projectGraph(nodes: SysNode[], edges: SysEdge[], options: GraphProjectionOptions = {}): GraphProjection {
  return projectGraphIndex(createGraphIndex(nodes, edges), options);
}

export function projectGraphIndex(index: GraphIndex, options: GraphProjectionOptions = {}): GraphProjection {
  const definition = projectionDefinition(options.projectionId ?? 'dependencies');
  return compatibilityProjection(projectVisibleGraph(index, definition, {
    activeNodeId: options.activeNodeId,
    rootNodeIds: options.rootNodeIds,
    upstreamDepth: options.upstreamDepth,
    downstreamDepth: options.downstreamDepth,
    edgeKinds: options.edgeKinds,
    frontierExpansions: options.branchExpansions,
    nodeBudget: options.nodeBudget,
    branchLimit: options.branchLimit,
    branchPageSize: options.branchPageSize,
  }));
}

export function projectPRGraph(nodes: SysNode[], edges: SysEdge[], options: Omit<GraphProjectionOptions, 'rootNodeIds'> = {}) {
  return projectPRGraphIndex(createGraphIndex(nodes, edges), options);
}

export function projectPRGraphIndex(index: GraphIndex, options: Omit<GraphProjectionOptions, 'rootNodeIds'> = {}) {
  const changed = index.nodes.filter((node) => node.pr).map((node) => node.id);
  const changedEdges = index.edges.filter((edge) => edge.pr).flatMap((edge) => [edge.source, edge.target]);
  return projectGraphIndex(index, { ...options, projectionId: options.projectionId ?? 'review', rootNodeIds: [...changed, ...changedEdges] });
}
