import type { EdgeKind } from '../data/types';
import type { ProjectionDepth, ProjectionDirection } from '../lib/graphProjection';
import { cn } from '../utils/cn';

const DEPTHS: ProjectionDepth[] = [0, 1, 2, 3, 'all'];

export interface ExpandedBranch {
  key: string;
  label: string;
  direction: ProjectionDirection;
}

interface GraphScopeControlsProps {
  upstream: ProjectionDepth;
  downstream: ProjectionDepth;
  setUpstream: (depth: ProjectionDepth) => void;
  setDownstream: (depth: ProjectionDepth) => void;
  relationships: EdgeKind[];
  enabledRelationships: ReadonlySet<EdgeKind>;
  toggleRelationship: (kind: EdgeKind) => void;
  expandedBranches?: ExpandedBranch[];
  collapseBranch?: (key: string) => void;
  evidenceLevel?: 'proven' | 'observed' | 'inferred';
  includeStale?: boolean;
  setEvidenceLevel?: (level: 'proven' | 'observed' | 'inferred') => void;
  setIncludeStale?: (include: boolean) => void;
}

function DepthControl({ label, value, setValue }: { label: string; value: ProjectionDepth; setValue: (depth: ProjectionDepth) => void }) {
  return (
    <label className="flex items-center gap-1.5 text-[10px] text-zinc-500">
      {label}
      <select
        aria-label={`${label} depth`}
        value={value}
        onChange={(event) => setValue(event.target.value === 'all' ? 'all' : Number(event.target.value) as ProjectionDepth)}
        className="h-6 rounded border border-zinc-700 bg-zinc-950 px-1.5 font-mono text-[10px] text-zinc-300 outline-none"
      >
        {DEPTHS.map((depth) => <option key={depth} value={depth}>{depth === 'all' ? 'All' : depth}</option>)}
      </select>
    </label>
  );
}

export function GraphScopeControls(props: GraphScopeControlsProps) {
  return (
    <div className="flex min-h-8 flex-wrap items-center gap-2 border-b border-zinc-800 px-3 py-1">
      <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">Scope</span>
      <DepthControl label="Upstream" value={props.upstream} setValue={props.setUpstream} />
      <DepthControl label="Downstream" value={props.downstream} setValue={props.setDownstream} />
      <span className="mx-1 h-4 w-px bg-zinc-800" />
      <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-600">Relationships</span>
      {props.relationships.map((kind) => (
        <button
          key={kind}
          onClick={() => props.toggleRelationship(kind)}
          className={cn(
            'rounded border px-1.5 py-0.5 font-mono text-[9.5px]',
            props.enabledRelationships.has(kind) ? 'border-sky-700/60 bg-sky-950/30 text-sky-300' : 'border-zinc-800 text-zinc-600 hover:text-zinc-400',
          )}
        >
          {kind.replace('_', ' ')}
        </button>
      ))}
      <span className="font-mono text-[9px] text-zinc-600">context links are semantic bridges</span>
      {props.evidenceLevel && <><span className="mx-1 h-4 w-px bg-zinc-800" /><label className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wider text-zinc-600">Evidence<select aria-label="Evidence level" value={props.evidenceLevel} onChange={(event) => props.setEvidenceLevel?.(event.target.value as 'proven' | 'observed' | 'inferred')} className="h-6 rounded border border-zinc-700 bg-zinc-950 px-1.5 font-mono text-[9.5px] normal-case tracking-normal text-zinc-300 outline-none"><option value="proven">Proven only</option><option value="observed">+ Observed</option><option value="inferred">+ Inferred</option></select></label><label className="flex items-center gap-1 text-[9.5px] text-zinc-500"><input type="checkbox" checked={props.includeStale} onChange={(event) => props.setIncludeStale?.(event.target.checked)} /> stale</label></>}
      {props.expandedBranches?.map((branch) => (
        <button
          key={branch.key}
          onClick={() => props.collapseBranch?.(branch.key)}
          className="rounded border border-amber-800/60 bg-amber-950/20 px-1.5 py-0.5 text-[9.5px] text-amber-300"
          title="Collapse branch"
        >
          Collapse {branch.direction === 'upstream' ? '↑' : '↓'} {branch.label}
        </button>
      ))}
    </div>
  );
}
