import type { SysNode } from '../data/types';

export function filterSymbols(nodes: readonly SysNode[], query: string, showPrivate: boolean): SysNode[] {
  const normalizedQuery = query.toLowerCase();
  return nodes.filter((node) => {
    if (!showPrivate && node.meta?.exported === false) return false;
    return !normalizedQuery || `${node.label} ${node.file ?? ''}`.toLowerCase().includes(normalizedQuery);
  });
}
