import type { InvestigationState } from '../investigation/types.ts';
import { cloneSavedState, parseSavedView, type SavedView } from './schema.ts';

export interface SavedViewStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SavedViewRepository {
  list(): SavedView[];
  save(name: string, state: InvestigationState): SavedView;
  remove(id: string): void;
}

const STORAGE_KEY = 'aegir:saved-views:v1';

export class LocalStorageSavedViewRepository implements SavedViewRepository {
  private readonly storage: SavedViewStorage;
  private readonly now: () => string;

  constructor(storage: SavedViewStorage, now = () => new Date().toISOString()) {
    this.storage = storage;
    this.now = now;
  }

  list() {
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.flatMap((value, position) => {
        const view = parseSavedView(value, position);
        return view ? [view] : [];
      }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    } catch {
      return [];
    }
  }

  save(name: string, state: InvestigationState) {
    const cleanName = name.trim();
    if (!cleanName) throw new Error('View name is required.');
    const views = this.list();
    const existing = views.find((view) => view.name.toLocaleLowerCase() === cleanName.toLocaleLowerCase() && view.state.contextKey === state.contextKey);
    const createdAt = existing?.createdAt ?? this.now();
    const view: SavedView = { version: 1, id: existing?.id ?? `view:${encodeURIComponent(cleanName)}:${createdAt}`, name: cleanName, createdAt, state: cloneSavedState(state) };
    const next = [...views.filter((item) => item.id !== view.id), view].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
    return view;
  }

  remove(id: string) {
    const next = this.list().filter((view) => view.id !== id);
    if (next.length === 0) this.storage.removeItem(STORAGE_KEY);
    else this.storage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
}
