import { Minus, Plus, RotateCcw } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import type { AttentionLandscape, AttentionUnit } from './types';
import { bubblePaintOrder, bubbleRadius, clamp, jitteredScore, scaleCanvasPoint, stableJitter, tooltipPosition, zoomAfterWheel, zoomedScore } from './geometry';

const regionColor: Record<AttentionUnit['region'], string> = {
  investigate: '#fb7185',
  protect: '#38bdf8',
  simplify: '#f59e0b',
  'low-attention': '#71717a',
};


interface AttentionMapProps {
  landscape: AttentionLandscape;
  units: AttentionUnit[];
  onOpen: (unitId: string) => void;
  theme?: 'light' | 'dark';
  touchedUnitIds?: ReadonlySet<string>;
  compact?: boolean;
}

export function AttentionMap({ landscape, units, onOpen, theme = 'dark', touchedUnitIds, compact = false }: AttentionMapProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const dismissTimer = useRef<number | undefined>(undefined);
  const [size, setSize] = useState({ width: 900, height: compact ? 280 : 500 });
  const [renderedSize, setRenderedSize] = useState(size);
  const [tooltipSize, setTooltipSize] = useState({ width: 224, height: 64 });
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState<{ unit: AttentionUnit; x: number; y: number }>();
  const points = useMemo(() => {
    const margin = { left: 58, right: 24, top: 25, bottom: 48 };
    const width = Math.max(1, size.width - margin.left - margin.right);
    const height = Math.max(1, size.height - margin.top - margin.bottom);
    return units.map((unit) => {
      const pointRadius = bubbleRadius(unit);
      const offset = stableJitter(unit.unit.id);
      const normalizedX = jitteredScore(unit.changeComplexity.score, landscape.policy.complexityHigh, zoom, offset.x / width);
      const normalizedY = jitteredScore(unit.impact.score, landscape.policy.impactHigh, zoom, -offset.y / height);
      return {
        unit,
        x: clamp(margin.left + normalizedX * width, margin.left + pointRadius + 2, margin.left + width - pointRadius - 2),
        y: clamp(margin.top + (1 - normalizedY) * height, margin.top + pointRadius + 2, margin.top + height - pointRadius - 2),
        radius: pointRadius,
      };
    });
  }, [landscape.policy, units, size, zoom]);
  const paintedPoints = useMemo(() => bubblePaintOrder(points), [points]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setRenderedSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      setSize((current) => {
        const next = { width: Math.max(420, entry.contentRect.width), height: Math.max(compact ? 260 : 360, entry.contentRect.height) };
        return current.width === next.width && current.height === next.height ? current : next;
      });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (dismissTimer.current !== undefined) window.clearTimeout(dismissTimer.current);
  }, []);

  useLayoutEffect(() => {
    if (!tooltip.current) return;
    const bounds = tooltip.current.getBoundingClientRect();
    setTooltipSize({ width: bounds.width, height: bounds.height });
  }, [hovered?.unit.unit.id, renderedSize]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const ratio = window.devicePixelRatio || 1;
    element.width = size.width * ratio; element.height = size.height * ratio;
    const context = element.getContext('2d');
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, size.width, size.height);
    const left = 58, right = size.width - 24, top = 25, bottom = size.height - 48;
    const thresholdX = left + zoomedScore(landscape.policy.complexityHigh, zoom) * (right - left);
    const thresholdY = top + (1 - zoomedScore(landscape.policy.impactHigh, zoom)) * (bottom - top);
    context.fillStyle = 'rgba(251,113,133,.035)'; context.fillRect(thresholdX, top, right - thresholdX, thresholdY - top);
    context.fillStyle = 'rgba(56,189,248,.025)'; context.fillRect(left, top, thresholdX - left, thresholdY - top);
    context.fillStyle = 'rgba(245,158,11,.025)'; context.fillRect(thresholdX, thresholdY, right - thresholdX, bottom - thresholdY);
    const foreground = theme === 'light' ? '#3f3f46' : '#e4e4e7';
    const muted = theme === 'light' ? '#71717a' : '#71717a';
    const grid = theme === 'light' ? '#d4d4d8' : '#3f3f46';
    context.strokeStyle = grid; context.lineWidth = 1; context.setLineDash([4, 5]);
    context.beginPath(); context.moveTo(thresholdX, top); context.lineTo(thresholdX, bottom); context.moveTo(left, thresholdY); context.lineTo(right, thresholdY); context.stroke(); context.setLineDash([]);
    context.strokeStyle = muted; context.beginPath(); context.moveTo(left, top); context.lineTo(left, bottom); context.lineTo(right, bottom); context.stroke();
    context.font = '11px ui-sans-serif, system-ui'; context.fillStyle = muted;
    context.fillText('Impact / Criticality', 8, top + 8); context.fillText('Change Complexity →', right - 118, size.height - 15);
    context.font = '600 10px ui-sans-serif, system-ui';
    context.fillStyle = '#fb7185'; context.fillText('INVESTIGATE / STABILIZE', thresholdX + 10, top + 16);
    context.fillStyle = '#38bdf8'; context.fillText('PROTECT', left + 10, top + 16);
    context.fillStyle = '#f59e0b'; context.fillText('SIMPLIFY', thresholdX + 10, bottom - 10);
    context.fillStyle = '#71717a'; context.fillText('LOW ATTENTION', left + 10, bottom - 10);
    const findingIds = new Set(landscape.findings.map((finding) => finding.unitId));
    for (const point of paintedPoints) {
      const color = regionColor[point.unit.region];
      context.globalAlpha = touchedUnitIds && !touchedUnitIds.has(point.unit.unit.id) ? .22 : 1;
      context.beginPath(); context.arc(point.x, point.y, point.radius, 0, Math.PI * 2);
      context.fillStyle = point.unit.changeVelocity.score == null ? (theme === 'light' ? 'rgba(244,244,245,.9)' : 'rgba(24,24,27,.9)') : color + '55'; context.fill();
      context.setLineDash(point.unit.changeVelocity.score == null ? [3, 2] : []);
      context.strokeStyle = color; context.lineWidth = findingIds.has(point.unit.unit.id) ? 2 : 1; context.stroke();
      context.setLineDash([]);
      if (touchedUnitIds?.has(point.unit.unit.id)) {
        context.beginPath(); context.arc(point.x, point.y, point.radius + 4, 0, Math.PI * 2); context.strokeStyle = foreground; context.lineWidth = 2; context.stroke();
      }
      if (findingIds.has(point.unit.unit.id) || hovered?.unit.unit.id === point.unit.unit.id) {
        context.font = '10px ui-monospace, monospace'; context.fillStyle = foreground; context.fillText(point.unit.unit.label, point.x + point.radius + 4, point.y + 3);
      }
    }
    context.globalAlpha = 1;
  }, [landscape, paintedPoints, size, hovered, theme, touchedUnitIds, zoom]);

  const findPoint = (event: MouseEvent<HTMLCanvasElement> | PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left, y = event.clientY - rect.top;
    const logical = scaleCanvasPoint(x, y, rect.width, rect.height, size.width, size.height);
    return { x, y, point: [...paintedPoints].reverse().find((item) => Math.hypot(item.x - logical.x, item.y - logical.y) <= item.radius + 5) };
  };
  const leaveCanvas = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.relatedTarget instanceof Node && tooltip.current?.contains(event.relatedTarget)) {
      if (dismissTimer.current !== undefined) window.clearTimeout(dismissTimer.current);
      dismissTimer.current = undefined;
      return;
    }
    setHovered(undefined);
  };
  const updateHovered = (event: PointerEvent<HTMLCanvasElement>) => {
    const hit = findPoint(event);
    if (hit.point) {
      if (dismissTimer.current !== undefined) window.clearTimeout(dismissTimer.current);
      dismissTimer.current = undefined;
      setHovered({ unit: hit.point.unit, x: hit.x, y: hit.y });
      return;
    }
    if (dismissTimer.current !== undefined) window.clearTimeout(dismissTimer.current);
    dismissTimer.current = window.setTimeout(() => {
      dismissTimer.current = undefined;
      setHovered(undefined);
    }, 150);
  };
  return <div className={`relative flex-1 overflow-hidden rounded-md border border-zinc-800 bg-zinc-950/50 ${compact ? 'min-h-[280px]' : 'min-h-[420px]'}`}>
    <canvas ref={canvas} className={`h-full w-full ${compact ? 'min-h-[280px]' : 'min-h-[420px]'}`} aria-label={`Attention Map with ${units.length} package bubbles`} onWheel={(event) => { const next = zoomAfterWheel(zoom, event.deltaY); if (next === zoom) return; event.preventDefault(); setZoom(next) }} onPointerMove={updateHovered} onPointerLeave={leaveCanvas} onClick={(event) => { const hit = findPoint(event); if (hit.point) onOpen(hit.point.unit.unit.id) }} />
    <div className="absolute right-2 top-2 flex rounded border border-zinc-700 bg-zinc-950/90" aria-label="Attention Map zoom controls"><button type="button" onClick={() => setZoom((value) => clamp(value - .25, 1, 3))} disabled={zoom === 1} aria-label="Zoom out" className="p-1.5 text-zinc-400 disabled:opacity-30"><Minus className="h-3 w-3" /></button><button type="button" onClick={() => setZoom(1)} aria-label="Reset zoom" title={`${Math.round(zoom * 100)}%`} className="border-x border-zinc-700 p-1.5 text-zinc-400"><RotateCcw className="h-3 w-3" /></button><button type="button" onClick={() => setZoom((value) => clamp(value + .25, 1, 3))} disabled={zoom === 3} aria-label="Zoom in" className="p-1.5 text-zinc-400 disabled:opacity-30"><Plus className="h-3 w-3" /></button></div>
    {hovered && <div ref={tooltip} role="tooltip" onPointerEnter={() => { if (dismissTimer.current !== undefined) window.clearTimeout(dismissTimer.current); dismissTimer.current = undefined }} onPointerLeave={() => setHovered(undefined)} className="pointer-events-auto absolute z-10 w-56 overflow-auto rounded-md border border-zinc-700 bg-zinc-950/95 p-2 shadow-xl" style={tooltipPosition(hovered.x, hovered.y, renderedSize.width, renderedSize.height, tooltipSize.width, tooltipSize.height)}><div className="font-mono text-[11px] text-zinc-100">{hovered.unit.unit.label}</div><div className="mt-1 grid grid-cols-3 gap-1 font-mono text-[9px] text-zinc-400"><span>Impact {hovered.unit.impact.score ?? '—'}</span><span>Complex {hovered.unit.changeComplexity.score ?? '—'}</span><span>Velocity {hovered.unit.changeVelocity.score ?? '—'}</span></div><button type="button" onClick={() => onOpen(hovered.unit.unit.id)} className="mt-1 text-[9px] text-zinc-500 hover:text-zinc-300">Click to explain in graph</button></div>}
  </div>;
}
