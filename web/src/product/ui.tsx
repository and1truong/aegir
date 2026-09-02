import type React from 'react';
import {
  AlertTriangle, Box, Braces, CheckCircle2, Cloud, Database, FileJson, FlaskConical, Globe, HelpCircle,
  Layers, Lock, Package, Radio, Server, Table, XCircle, Zap,
} from 'lucide-react';
import type { CoverageStatus, NodeKind, Severity } from '../data/types';
import { cn } from '../utils/cn';

const kindIcons: Record<NodeKind, React.ComponentType<{ className?: string }>> = {
  service: Server, package: Package, function: Braces, method: Braces, endpoint: Globe, topic: Radio,
  table: Table, cache: Zap, external: Cloud, transaction: Lock, test: FlaskConical, contract: FileJson,
  database: Database, broker: Layers,
};

const kindColor: Record<NodeKind, string> = {
  service: 'text-sky-300', package: 'text-zinc-400', function: 'text-zinc-200', method: 'text-zinc-200',
  endpoint: 'text-emerald-300', topic: 'text-violet-300', table: 'text-amber-300', cache: 'text-rose-300',
  external: 'text-orange-300', transaction: 'text-fuchsia-300', test: 'text-teal-300', contract: 'text-indigo-300',
  database: 'text-amber-300', broker: 'text-violet-300',
};

export function KindIcon({ kind, className }: { kind: NodeKind; className?: string }) {
  const Icon = kindIcons[kind] ?? Box;
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', kindColor[kind], className)} />;
}

type Tone = 'neutral' | 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'orange' | 'fuchsia';
const toneStyles: Record<Tone, string> = {
  neutral: 'bg-zinc-800/80 text-zinc-300 border-zinc-700', green: 'bg-emerald-950 text-emerald-300 border-emerald-900',
  amber: 'bg-amber-950 text-amber-300 border-amber-900', red: 'bg-red-950 text-red-300 border-red-900',
  blue: 'bg-sky-950 text-sky-300 border-sky-900', violet: 'bg-violet-950 text-violet-300 border-violet-900',
  orange: 'bg-orange-950 text-orange-300 border-orange-900', fuchsia: 'bg-fuchsia-950 text-fuchsia-300 border-fuchsia-900',
};

export function Badge({ tone = 'neutral', children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-sm border px-1.5 py-px font-mono text-[10px] font-medium tracking-wide', toneStyles[tone], className)}>{children}</span>;
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  const tones: Record<Severity, Tone> = { high: 'red', medium: 'amber', low: 'blue' };
  return <Badge tone={tones[severity]}>{severity.toUpperCase()}</Badge>;
}

export function CoverageIcon({ status, className }: { status: CoverageStatus; className?: string }) {
  const classes = cn('h-3.5 w-3.5 shrink-0', className);
  if (status === 'covered') return <CheckCircle2 className={cn(classes, 'text-emerald-400')} />;
  if (status === 'partial') return <AlertTriangle className={cn(classes, 'text-amber-400')} />;
  if (status === 'uncovered') return <XCircle className={cn(classes, 'text-red-400')} />;
  return <HelpCircle className={cn(classes, 'text-zinc-500')} />;
}

export function Btn({ children, onClick, className, size = 'sm', variant = 'ghost', disabled }: { children: React.ReactNode; onClick?: () => void; className?: string; size?: 'xs' | 'sm'; variant?: 'ghost' | 'solid' | 'outline'; disabled?: boolean }) {
  return <button disabled={disabled} onClick={onClick} className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors', size === 'xs' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-[12px]', variant === 'ghost' && 'border-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100', variant === 'outline' && 'border-zinc-700 text-zinc-300 hover:bg-zinc-800', variant === 'solid' && 'border-sky-500/40 bg-sky-500/15 text-sky-200 hover:bg-sky-500/25', disabled && 'cursor-not-allowed opacity-50', className)}>{children}</button>;
}
