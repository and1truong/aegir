import type { Point } from './types';

export interface Viewport { x: number; y: number; zoom: number }

export function screenPoint(model: Point, viewport: Viewport): Point {
  return { x: model.x * viewport.zoom + viewport.x, y: model.y * viewport.zoom + viewport.y };
}

export function viewportForAnchor(model: Point, slot: Point, zoom: number): Viewport {
  return { x: slot.x - model.x * zoom, y: slot.y - model.y * zoom, zoom };
}

export function clampSlot(slot: Point, width: number, height: number): Point {
  return { x: Math.max(width * 0.2, Math.min(width * 0.8, slot.x)), y: Math.max(height * 0.2, Math.min(height * 0.8, slot.y)) };
}
