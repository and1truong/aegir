import { AlertTriangle, Loader2, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useProduct } from '../product/ProductContext';
import { Btn, Badge } from '../product/ui';
import { AttentionMap } from './AttentionMap';
import { AttentionEvidencePanel } from './AttentionEvidencePanel';
import type { AttentionLandscape, AttentionUnit } from './types';

const regionLabel = { investigate: 'Investigate / Stabilize', protect: 'Protect', simplify: 'Simplify', 'low-attention': 'Low Attention' } as const;
const regions = new Set(['investigate', 'protect', 'simplify', 'low-attention']);

function initialWindow() {
  const value = Number(new URL(window.location.href).searchParams.get('window'));
  return value === 30 || value === 180 ? value : 90;
}

function subsystem(unit: AttentionUnit) {
  if (unit.unit.subsystem) return unit.unit.subsystem;
  const path = unit.unit.path ?? unit.unit.label;
  return path.includes('/') ? path.split('/')[0] : 'root';
}

function teamsForUnit(unit: AttentionUnit) {
  return unit.unit.teams?.length ? unit.unit.teams : unit.unit.team ? [unit.unit.team] : [];
}

export function AttentionOverview({ openUnit, theme }: { openUnit: (unitId: string) => void; theme: 'light' | 'dark' }) {
  const { snapshot, active, reindex, loading } = useProduct();
  const [windowDays, setWindowDays] = useState(initialWindow);
  const [query, setQuery] = useState(() => new URL(window.location.href).searchParams.get('q') ?? '');
  const [region, setRegion] = useState<AttentionUnit['region'] | 'all'>(() => {
    const value = new URL(window.location.href).searchParams.get('region');
    return value && regions.has(value) ? value as AttentionUnit['region'] : 'all';
  });
  const [scope, setScope] = useState(() => new URL(window.location.href).searchParams.get('scope') ?? 'all');
  const [team, setTeam] = useState(() => new URL(window.location.href).searchParams.get('team') ?? 'all');
  const [selectedUnitID, setSelectedUnitID] = useState(() => new URL(window.location.href).searchParams.get('unit') ?? '');
  const [landscape, setLandscape] = useState<AttentionLandscape>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!snapshot || !active) return;
    const controller = new AbortController(); setLandscape(undefined); setError('');
    fetch(`/api/repositories/${active.id}/attention?snapshot=${snapshot.id}&window=${windowDays}`, { signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error ?? 'Attention analysis failed.'); return body as AttentionLandscape })
      .then(setLandscape).catch((cause) => { if (cause.name !== 'AbortError') setError(cause instanceof Error ? cause.message : String(cause)) });
    return () => controller.abort();
  }, [active?.id, snapshot?.id, windowDays]);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('window', String(windowDays));
    if (query) url.searchParams.set('q', query); else url.searchParams.delete('q');
    if (region !== 'all') url.searchParams.set('region', region); else url.searchParams.delete('region');
    if (scope !== 'all') url.searchParams.set('scope', scope); else url.searchParams.delete('scope');
    if (team !== 'all') url.searchParams.set('team', team); else url.searchParams.delete('team');
    if (selectedUnitID) url.searchParams.set('unit', selectedUnitID); else url.searchParams.delete('unit');
    window.history.replaceState({}, '', url);
  }, [windowDays, query, region, scope, team, selectedUnitID]);
  const subsystems = useMemo(() => [...new Set((landscape?.units ?? []).map(subsystem))].sort(), [landscape]);
  const teams = useMemo(() => [...new Set((landscape?.units ?? []).flatMap(teamsForUnit))].sort(), [landscape]);
  useEffect(() => { if (scope !== 'all' && landscape && !subsystems.includes(scope)) setScope('all') }, [landscape, scope, subsystems]);
  useEffect(() => { if (team !== 'all' && landscape && !teams.includes(team)) setTeam('all') }, [landscape, team, teams]);
  const units = useMemo(() => (landscape?.units ?? []).filter((unit) => (region === 'all' || unit.region === region) && (scope === 'all' || subsystem(unit) === scope) && (team === 'all' || teamsForUnit(unit).includes(team)) && (!query.trim() || `${unit.unit.label} ${unit.unit.path ?? ''}`.toLowerCase().includes(query.toLowerCase()))), [landscape, query, region, scope, team]);
  const accessibleUnits = useMemo(() => units.length <= 200 ? units : [...units].sort((left, right) => right.priority - left.priority || left.unit.id.localeCompare(right.unit.id)).slice(0, 200), [units]);
  const selectedUnit = landscape?.units.find((unit) => unit.unit.id === selectedUnitID);
  if (!snapshot || !active) return null;
  return <div className="flex h-full min-h-0 flex-col overflow-y-auto p-5"><div className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col">
    <div className="flex items-end justify-between"><div><div className="font-mono text-[10px] text-zinc-500">{active.path} · {active.head?.slice(0, 12) || 'working tree'}</div><h1 className="text-[18px] font-semibold">What deserves attention?</h1></div><Btn onClick={() => void reindex()} disabled={loading}>{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Re-index</Btn></div>
    {error && <div className="mt-4 rounded-md border border-red-900/60 bg-red-950/20 p-3 text-[11px] text-red-200">{error}</div>}
    {!landscape && !error ? <div className="flex flex-1 items-center justify-center text-[11px] text-zinc-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Calculating package attention…</div> : landscape && <>
      <section className="mt-4 rounded-md border border-zinc-800 bg-zinc-900/20"><div className="border-b border-zinc-800 px-3 py-2"><span className="text-[12px] font-semibold">Aegir found {landscape.findings.length} area{landscape.findings.length === 1 ? '' : 's'} worth your attention.</span><span className="ml-2 text-[10px] text-zinc-500">Deterministic · {landscape.windowDays}-day window</span></div><div className="grid gap-px bg-zinc-800 md:grid-cols-3">{landscape.findings.map((finding) => <article key={finding.id} className="bg-zinc-950 p-3"><div className="flex items-center gap-2"><Badge tone={finding.region === 'investigate' ? 'red' : finding.region === 'protect' ? 'blue' : finding.region === 'simplify' ? 'amber' : 'neutral'}>{regionLabel[finding.region]}</Badge><span className="ml-auto font-mono text-[10px] text-zinc-500">priority {finding.priority}</span></div><div className="mt-2 font-mono text-[11px] text-zinc-100">{finding.title}</div><div className="mt-1 text-[10px] leading-relaxed text-zinc-500">{finding.explanation}</div><div className="mt-2 flex gap-3 text-[9px]"><button type="button" onClick={() => openUnit(finding.unitId)} className="text-sky-300 hover:underline">Open graph</button><button type="button" onClick={() => setSelectedUnitID(finding.unitId)} className="text-zinc-400 hover:text-zinc-200">Explain scores</button></div></article>)}{landscape.findings.length === 0 && <div className="col-span-3 bg-zinc-950 p-4 text-[11px] text-zinc-500">No package crossed the current attention thresholds.</div>}</div></section>
      {landscape.completeness.warnings.length > 0 && <div className="mt-2 flex items-start gap-2 text-[10px] text-amber-300"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{landscape.completeness.warnings[0]}</div>}
      <div className="mt-3 flex items-center gap-2"><div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2"><Search className="h-3.5 w-3.5 text-zinc-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter packages" className="w-full bg-transparent text-[11px] outline-none" /></div>{subsystems.length > 1 && <select aria-label="Subsystem" value={scope} onChange={(event) => setScope(event.target.value)} className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[10px] text-zinc-300"><option value="all">All subsystems</option>{subsystems.map((value) => <option key={value} value={value}>{value}</option>)}</select>}{teams.length > 1 && <select aria-label="Team" value={team} onChange={(event) => setTeam(event.target.value)} className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[10px] text-zinc-300"><option value="all">All teams</option>{teams.map((value) => <option key={value} value={value}>{value}</option>)}</select>}<select aria-label="Attention region" value={region} onChange={(event) => setRegion(event.target.value as typeof region)} className="h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 text-[10px] text-zinc-300"><option value="all">All regions</option><option value="investigate">Investigate / Stabilize</option><option value="protect">Protect</option><option value="simplify">Simplify</option><option value="low-attention">Low Attention</option></select><label className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">Velocity window <select value={windowDays} onChange={(event) => setWindowDays(Number(event.target.value))} className="ml-1 h-8 rounded-md border border-zinc-800 bg-zinc-950 px-2 font-mono text-[10px] normal-case tracking-normal text-zinc-300"><option value={30}>30 days</option><option value={90}>90 days</option><option value={180}>180 days</option></select></label></div>
      <div className={`mt-2 grid min-h-[420px] flex-1 gap-2 ${selectedUnit ? 'grid-cols-[minmax(0,1fr)_320px]' : 'grid-cols-1'}`}><AttentionMap landscape={landscape} units={units} onOpen={openUnit} theme={theme} />{selectedUnit && <AttentionEvidencePanel repositoryId={active.id} snapshotId={snapshot.id} windowDays={windowDays} unit={selectedUnit} close={() => setSelectedUnitID('')} openGraph={() => openUnit(selectedUnit.unit.id)} />}</div>
      <div className="mt-1 flex gap-4 font-mono text-[8px] text-zinc-600"><span>Thresholds · impact ≥ {landscape.policy.impactHigh} · complexity ≥ {landscape.policy.complexityHigh}</span><span>Bubble area = change velocity</span><span>Dashed = history unavailable</span><span>{units.length} of {landscape.units.length} packages shown</span></div>
      <div className="mt-2 flex flex-wrap gap-1" aria-label="Accessible package attention list">{accessibleUnits.map((unit) => <button key={unit.unit.id} onClick={() => setSelectedUnitID(unit.unit.id)} onDoubleClick={() => openUnit(unit.unit.id)} className="rounded border border-zinc-800 px-2 py-1 font-mono text-[9px] text-zinc-500 hover:text-sky-200">{unit.unit.label}: impact {unit.impact.score ?? 'unknown'}, complexity {unit.changeComplexity.score ?? 'unknown'}, velocity {unit.changeVelocity.score ?? 'unknown'}</button>)}{accessibleUnits.length < units.length && <span className="px-2 py-1 text-[9px] text-zinc-600">Top 200 listed; filter to inspect the rest.</span>}</div>
    </>}
  </div></div>;
}
