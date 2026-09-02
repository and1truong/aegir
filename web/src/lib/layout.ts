import dagre from '@dagrejs/dagre';

export interface LayoutInput {
  id: string;
  width: number;
  height: number;
}

export function layout(items: LayoutInput[], links: { source: string; target: string }[], opts: { rankdir?: 'LR' | 'TB'; ranksep?: number; nodesep?: number } = {}) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: opts.rankdir ?? 'LR', ranksep: opts.ranksep ?? 70, nodesep: opts.nodesep ?? 28, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(items.map((item) => item.id));
  items.forEach((item) => graph.setNode(item.id, { width: item.width, height: item.height }));
  links.forEach((link) => {
    if (ids.has(link.source) && ids.has(link.target) && link.source !== link.target) graph.setEdge(link.source, link.target);
  });
  dagre.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  items.forEach((item) => {
    const node = graph.node(item.id);
    positions.set(item.id, { x: (node?.x ?? 0) - item.width / 2, y: (node?.y ?? 0) - item.height / 2 });
  });
  return positions;
}
