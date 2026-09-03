import type { AttentionUnit } from './types';

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function stableJitter(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return { x: ((hash & 15) - 7.5) / 2, y: (((hash >>> 4) & 15) - 7.5) / 2 };
}

export function bubbleRadius(unit: AttentionUnit) {
  if (unit.changeVelocity.score == null) return 6;
  const area = 110 + 700 * unit.changeVelocity.score / 100;
  return Math.sqrt(area / Math.PI);
}

export function zoomedScore(value: number | null, zoom: number) {
  return clamp(.5 + ((value ?? 0) / 100 - .5) * zoom, 0, 1);
}

export function jitteredScore(value: number | null, threshold: number, zoom: number, jitter: number) {
  const score = value ?? 0;
  const boundary = zoomedScore(threshold, zoom);
  const shifted = zoomedScore(value, zoom) + jitter;
  return clamp(score >= threshold ? Math.max(shifted, boundary) : Math.min(shifted, boundary - Number.EPSILON), 0, 1);
}

export function bubblePaintOrder<T extends { unit: AttentionUnit }>(points: readonly T[]) {
  return [...points].sort((left, right) => bubbleRadius(right.unit) - bubbleRadius(left.unit) || left.unit.unit.id.localeCompare(right.unit.unit.id));
}

export function scaleCanvasPoint(x: number, y: number, cssWidth: number, cssHeight: number, logicalWidth: number, logicalHeight: number) {
  return { x: x * logicalWidth / Math.max(1, cssWidth), y: y * logicalHeight / Math.max(1, cssHeight) };
}
