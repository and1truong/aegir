export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface LayoutNode extends Size { id: string }
export interface LayoutLink { source: string; target: string }
export type LayoutStrategy = 'dependency-LR' | 'dataflow-LR' | 'review-LR' | 'explicit-TB';

export interface PositionedLayout {
  topologyRevision: string;
  layoutRevision: number;
  positions: Map<string, Point>;
  anchor: { nodeId: string; modelPoint: Point } | null;
}
