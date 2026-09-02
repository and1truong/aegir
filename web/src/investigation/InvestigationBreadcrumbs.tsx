import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { SysNode } from '../data/types';
import { useInvestigation } from './InvestigationContext';

export function InvestigationBreadcrumbs({ nodes }: { nodes: readonly SysNode[] }) {
  const { breadcrumbs, canGoBack, canGoForward, goBack, goForward } = useInvestigation();
  const labels = new Map(nodes.map((node) => [node.id, node.label]));
  const trail = breadcrumbs.slice(-5);
  if (!canGoBack && !canGoForward && trail.length < 2) return null;
  return <div className="flex min-h-8 items-center gap-1 border-b border-zinc-800 bg-zinc-950/40 px-3" aria-label="Investigation history"><button onClick={goBack} disabled={!canGoBack} aria-label="Previous investigation" className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"><ChevronLeft className="h-3.5 w-3.5" /></button><button onClick={goForward} disabled={!canGoForward} aria-label="Next investigation" className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-30"><ChevronRight className="h-3.5 w-3.5" /></button><span className="mx-1 h-4 w-px bg-zinc-800" />{trail.map((state, index) => <span key={`${state.focalNodeId}:${index}`} className={index === trail.length - 1 ? 'font-mono text-[10px] text-sky-200' : 'font-mono text-[10px] text-zinc-500'}>{index > 0 && <span className="mr-1 text-zinc-700">/</span>}{labels.get(state.focalNodeId!) ?? state.focalNodeId}</span>)}</div>;
}
