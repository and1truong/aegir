import type { LayoutNode, Point } from './types';

export function normalizeToAnchor(positions: ReadonlyMap<string, Point>, nodes: readonly LayoutNode[], anchorId?: string) {
  const sizes = new Map(nodes.map((node) => [node.id, node]));
  const anchorPosition = anchorId ? positions.get(anchorId) : undefined;
  const anchorSize = anchorId ? sizes.get(anchorId) : undefined;
  if (!anchorId || !anchorPosition || !anchorSize) return { positions: new Map(positions), anchor: null };
  const center = { x: anchorPosition.x + anchorSize.width / 2, y: anchorPosition.y + anchorSize.height / 2 };
  return {
    positions: new Map([...positions].map(([id, point]) => [id, { x: point.x - center.x, y: point.y - center.y }])),
    anchor: { nodeId: anchorId, modelPoint: { x: 0, y: 0 } },
  };
}
