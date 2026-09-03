import { AlertTriangle, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useProduct } from '../product/ProductContext';
import { Badge } from '../product/ui';
import { AttentionMap } from './AttentionMap';
import type { ReviewAttention } from './types';

export function ReviewAttentionBar({ reviewId, theme, openUnit }: { reviewId: string; theme: 'light' | 'dark'; openUnit: (focalNodeId: string) => void }) {
  const { active } = useProduct();
  const [value, setValue] = useState<ReviewAttention>();
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setValue(undefined); setError('');
    fetch(`/api/repositories/${active.id}/attention/reviews/${reviewId}?window=90`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Review attention failed.'); return body as ReviewAttention })
      .then(setValue).catch((cause) => { if (cause.name !== 'AbortError') setError(cause instanceof Error ? cause.message : String(cause)) });
    return () => controller.abort();
  }, [active?.id, reviewId]);
  const touched = useMemo(() => value?.units.filter((unit) => unit.touched) ?? [], [value]);
  const touchedIDs = useMemo(() => new Set(touched.map((unit) => unit.unit.unit.id)), [touched]);
  if (error) return <div className="flex min-h-9 items-center gap-2 border-b border-amber-900/40 bg-amber-950/10 px-3 text-[9.5px] text-amber-300"><AlertTriangle className="h-3 w-3" />Review attention unavailable: {error}</div>;
  if (!value) return <div className="flex min-h-9 items-center gap-2 border-b border-zinc-800 px-3 text-[9.5px] text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" />Ranking review attention…</div>;
  const open = (unitID: string) => {
    const unit = value.units.find((item) => item.unit.unit.id === unitID);
    if (unit) openUnit(unit.focalNodeId ?? unit.unit.unit.id);
  };
  return <section className="border-b border-zinc-800 bg-rose-950/10"><div className="flex min-h-9 items-center gap-2 px-3"><span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-rose-400">Review attention</span><span className="text-[9.5px] text-zinc-400">{value.summary}</span><span className="shrink-0 font-mono text-[8px] text-zinc-600">+{value.newNodes} nodes · +{value.newRelationships} relationships</span>{touched.slice(0, 3).map((unit) => <button type="button" key={unit.unit.unit.id} onClick={() => open(unit.unit.unit.id)} className="ml-1 flex shrink-0 items-center gap-1 rounded border border-rose-900/60 px-2 py-1 font-mono text-[9px] text-rose-200"><Badge tone={unit.unit.region === 'investigate' ? 'red' : unit.unit.region === 'protect' ? 'blue' : unit.unit.region === 'simplify' ? 'amber' : 'neutral'}>{unit.reviewPriority}</Badge>{unit.unit.unit.label}</button>)}<button type="button" onClick={() => setExpanded((current) => !current)} aria-expanded={expanded} className="ml-auto flex shrink-0 items-center gap-1 text-[9px] text-zinc-400">{expanded ? 'Hide map' : 'Show map'} {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</button></div>{expanded && <div className="h-[300px] border-t border-zinc-800 p-2"><AttentionMap compact landscape={value.baseline} units={value.units.map((unit) => unit.unit)} touchedUnitIds={touchedIDs} onOpen={open} theme={theme} /></div>}</section>;
}
