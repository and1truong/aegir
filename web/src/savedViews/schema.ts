import { createInvestigationState, type InvestigationState } from '../investigation/types.ts';

export interface SavedView {
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  state: InvestigationState;
}

export interface SavedViewRestore {
  state: InvestigationState;
  warnings: Array<{ code: 'stale-context' | 'missing-focal' | 'missing-pin' | 'broken-path'; message: string }>;
}

function isState(value: unknown): value is InvestigationState {
  if (!value || typeof value !== 'object') return false;
  const state = value as Partial<InvestigationState>;
  return typeof state.contextKey === 'string'
    && typeof state.projectionId === 'string'
    && Boolean(state.depth && typeof state.depth === 'object')
    && Array.isArray(state.pinnedNodeIds)
    && Boolean(state.evidencePolicy && typeof state.evidencePolicy === 'object');
}

function copyState(state: InvestigationState): InvestigationState {
  return {
    ...createInvestigationState({ contextKey: state.contextKey, projectionId: state.projectionId }),
    ...state,
    selectedEntity: state.selectedEntity ? { ...state.selectedEntity } : null,
    depth: { ...state.depth },
    relationshipOverrides: { ...state.relationshipOverrides },
    evidencePolicy: { ...state.evidencePolicy },
    expandedFrontiers: Object.fromEntries(Object.entries(state.expandedFrontiers ?? {}).map(([id, expansion]) => [id, { ...expansion }])),
    pinnedNodeIds: [...state.pinnedNodeIds],
    lockedPath: state.lockedPath ? { ...state.lockedPath, nodeIds: [...state.lockedPath.nodeIds], edgeIds: [...state.lockedPath.edgeIds], evidencePolicy: { ...state.lockedPath.evidencePolicy } } : undefined,
    budget: { ...state.budget },
  };
}

export function parseSavedView(value: unknown, position = 0): SavedView | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Partial<SavedView> & { version?: number };
  if (typeof record.name !== 'string' || !record.name.trim() || !isState(record.state)) return undefined;
  const name = record.name.trim();
  if (record.version === 1 && typeof record.id === 'string' && typeof record.createdAt === 'string') return { version: 1, id: record.id, name, createdAt: record.createdAt, state: copyState(record.state) };
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : 'legacy';
  return { version: 1, id: typeof record.id === 'string' ? record.id : `view:legacy:${encodeURIComponent(name)}:${position}`, name, createdAt, state: copyState(record.state) };
}

export function hydrateSavedView(view: SavedView, contextKey: string, availableNodeIds: ReadonlySet<string>, availableEdgeIds: ReadonlySet<string>): SavedViewRestore {
  const state = copyState(view.state);
  const warnings: SavedViewRestore['warnings'] = [];
  if (state.contextKey !== contextKey) warnings.push({ code: 'stale-context', message: `Saved for ${state.contextKey}; restoring against ${contextKey}.` });
  state.contextKey = contextKey;
  if (state.focalNodeId && !availableNodeIds.has(state.focalNodeId)) {
    warnings.push({ code: 'missing-focal', message: 'The saved focal node is missing in this snapshot.' });
    state.focalNodeId = state.lockedPath?.nodeIds.find((id) => availableNodeIds.has(id)) ?? state.pinnedNodeIds.find((id) => availableNodeIds.has(id));
  }
  const missingPins = state.pinnedNodeIds.filter((id) => !availableNodeIds.has(id));
  if (missingPins.length) warnings.push({ code: 'missing-pin', message: `${missingPins.length} saved pin${missingPins.length === 1 ? '' : 's'} are missing.` });
  state.pinnedNodeIds = state.pinnedNodeIds.filter((id) => availableNodeIds.has(id));
  if (state.lockedPath) {
    const broken = state.lockedPath.nodeIds.filter((id) => !availableNodeIds.has(id)).length + state.lockedPath.edgeIds.filter((id) => !availableEdgeIds.has(id)).length;
    if (broken) warnings.push({ code: 'broken-path', message: `The saved path has ${broken} missing segment${broken === 1 ? '' : 's'}.` });
  }
  state.selectedEntity = state.focalNodeId ? { kind: 'node', id: state.focalNodeId } : null;
  return { state, warnings };
}

export function cloneSavedState(state: InvestigationState) {
  return copyState(state);
}
