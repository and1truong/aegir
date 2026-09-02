import type { AbstractionLevel } from '../investigation/types';

export const abstractionShortcuts: Record<string, { level: AbstractionLevel; label: string; description: string }> = {
  '1': { level: 'service', label: 'Service', description: 'System boundaries and cross-service relationships.' },
  '2': { level: 'component', label: 'Component', description: 'Logical components, falling back to packages when components are unavailable.' },
  '3': { level: 'package', label: 'Package', description: 'Package-level dependencies and ownership.' },
  '4': { level: 'symbol', label: 'Execution detail', description: 'Functions, methods, resources, and call-level evidence.' },
};

export const abstractionShortcutStatus = 'prototype' as const;

export interface ShortcutEventLike {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  target?: { tagName?: string; isContentEditable?: boolean } | null;
}

export function abstractionShortcutForEvent(event: ShortcutEventLike) {
  const tag = event.target?.tagName?.toLowerCase();
  if (event.metaKey || event.ctrlKey || event.altKey || event.target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select') return undefined;
  return abstractionShortcuts[event.key];
}

