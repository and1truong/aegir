import { ExternalLink, GitCommitHorizontal, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { AttentionDimension, AttentionEvidenceBundle, AttentionUnit } from './types';

function Dimension({ label, dimension }: { label: string; dimension: AttentionDimension }) {
  const factors = [...dimension.factors].sort((left, right) => right.contribution - left.contribution || left.id.localeCompare(right.id));
  return <section className="border-t border-zinc-800 py-3 first:border-0 first:pt-0">
    <div className="flex items-baseline"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</h3><span className="ml-auto font-mono text-[18px] text-zinc-100">{dimension.score ?? '—'}</span></div>
    <div className="mb-2 text-right font-mono text-[8px] text-zinc-600">{Math.round(dimension.coverage * 100)}% signal coverage</div>
    {factors.map((factor) => <div key={factor.id} className="mb-2 last:mb-0"><div className="flex gap-2 text-[10px]"><span className={factor.status === 'observed' ? 'text-zinc-300' : 'text-zinc-600'}>{factor.label}</span><span className="ml-auto shrink-0 font-mono text-zinc-500">{factor.status === 'observed' ? factor.displayValue : 'unavailable'}</span></div>{factor.status === 'observed' && <div className="mt-1 h-1 overflow-hidden rounded bg-zinc-900"><div className="h-full bg-sky-500/60" style={{ width: `${Math.round(factor.normalized * 100)}%` }} /></div>}{factor.evidenceRefs.length > 0 && <div className="mt-0.5 font-mono text-[8px] text-zinc-600">{factor.evidenceRefs.length} evidence reference{factor.evidenceRefs.length === 1 ? '' : 's'}</div>}</div>)}
  </section>;
}

export function AttentionEvidencePanel({ repositoryId, snapshotId, windowDays, unit, close, openGraph }: { repositoryId: string; snapshotId: number; windowDays: number; unit: AttentionUnit; close: () => void; openGraph: () => void }) {
  const [bundle, setBundle] = useState<AttentionEvidenceBundle>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setBundle(undefined); setError('');
    fetch(`/api/repositories/${repositoryId}/attention/evidence?snapshot=${snapshotId}&window=${windowDays}&unitId=${encodeURIComponent(unit.unit.id)}`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Evidence could not be loaded.'); return body as AttentionEvidenceBundle })
      .then(setBundle).catch((cause) => { if (cause.name !== 'AbortError') setError(cause instanceof Error ? cause.message : String(cause)) });
    return () => controller.abort();
  }, [repositoryId, snapshotId, windowDays, unit.unit.id]);
  return <aside className="min-h-0 overflow-y-auto rounded-md border border-zinc-800 bg-zinc-950/80 p-3" aria-label={`Score explanation for ${unit.unit.label}`}>
    <div className="flex items-start gap-2"><div className="min-w-0"><div className="text-[9px] font-semibold uppercase tracking-wider text-sky-400">Why this matters</div><h2 className="mt-1 truncate font-mono text-[12px] text-zinc-100">{unit.unit.label}</h2><div className="mt-0.5 text-[9px] text-zinc-600">priority {unit.priority} · {unit.memberCount} indexed members</div></div><button type="button" onClick={close} aria-label="Close score explanation" className="ml-auto p-1 text-zinc-500 hover:text-zinc-200"><X className="h-3.5 w-3.5" /></button></div>
    <button type="button" onClick={openGraph} className="mt-3 flex w-full items-center justify-center gap-1 rounded border border-sky-800 bg-sky-950/40 px-2 py-1.5 text-[10px] text-sky-200">Explain in graph <ExternalLink className="h-3 w-3" /></button>
    <div className="mt-3"><Dimension label="Impact / Criticality" dimension={unit.impact} /><Dimension label="Change Complexity" dimension={unit.changeComplexity} /><Dimension label="Change Velocity" dimension={unit.changeVelocity} /></div>
    {!bundle && !error && <div className="flex items-center gap-2 border-t border-zinc-800 pt-3 text-[9px] text-zinc-500"><Loader2 className="h-3 w-3 animate-spin" />Resolving evidence…</div>}
    {error && <div className="border-t border-zinc-800 pt-3 text-[9px] text-red-300">{error}</div>}
    {bundle && <section className="border-t border-zinc-800 pt-3"><h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Concrete evidence</h3><div className="mt-2 text-[9px] text-zinc-500">{bundle.graphEdges.length} dependency edges · {bundle.sourceEvidence.length} source locations · {bundle.gitChanges.length} recent changes</div>{bundle.gitChanges.slice(0, 5).map((change) => <div key={change.id} className="mt-2 border-l border-zinc-800 pl-2"><div className="flex items-center gap-1.5 font-mono text-[9px] text-zinc-300"><GitCommitHorizontal className="h-3 w-3 text-violet-400" />{change.commit.slice(0, 9)} <span className="text-zinc-600">{new Date(change.occurredAt).toLocaleDateString()}</span></div>{change.summary && <div className="mt-0.5 truncate text-[9px] text-zinc-400">{change.summary}</div>}<div className="mt-0.5 truncate font-mono text-[8px] text-zinc-600">{change.files.filter((file) => !file.excluded).slice(0, 2).map((file) => file.path).join(', ')}</div></div>)}{bundle.sourceEvidence.slice(0, 5).map((evidence) => <div key={evidence.id} className="mt-2 text-[9px]"><div className="text-zinc-400">{evidence.summary}</div>{evidence.location && <div className="truncate font-mono text-[8px] text-zinc-600">{evidence.location.file}{evidence.location.line ? `:${evidence.location.line}` : ''}</div>}</div>)}</section>}
  </aside>;
}
