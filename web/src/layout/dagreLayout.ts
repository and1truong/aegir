import { layout } from '../lib/layout.ts';
import { normalizeToAnchor } from './anchor.ts';
import type { LayoutLink, LayoutNode, LayoutStrategy, PositionedLayout } from './types';

const cache = new Map<string, PositionedLayout>();
let revision = 0;
let computations = 0;

function rankdir(strategy: LayoutStrategy) {
  return strategy === 'explicit-TB' ? 'TB' as const : 'LR' as const;
}

export function positionGraph(topologyRevision: string, nodes: readonly LayoutNode[], links: readonly LayoutLink[], strategy: LayoutStrategy, anchorId?: string): PositionedLayout {
  const key = `${topologyRevision}|${strategy}|${anchorId ?? ''}`;
  const cached = cache.get(key);
  if (cached) return cached;
  computations++;
  const orderedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const orderedLinks = [...links].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target));
  const raw = layout(orderedNodes, orderedLinks, { rankdir: rankdir(strategy), ranksep: 64, nodesep: 22 });
  const normalized = normalizeToAnchor(raw, orderedNodes, anchorId);
  const result = { topologyRevision, layoutRevision: ++revision, positions: normalized.positions, anchor: normalized.anchor };
  cache.set(key, result);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return result;
}

export function layoutComputationCount() {
  return computations;
}

export function clearLayoutCache() {
  cache.clear();
  computations = 0;
  revision = 0;
}
