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
