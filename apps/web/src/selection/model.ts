export type SelectionScope =
  | { kind: 'folder'; id: string }
  | { kind: 'search'; query: string; musicFolderId?: string }
  | { kind: 'playlist'; id: string; revision: string }
  | { kind: 'favorites' };

export type SelectionItem = { id: string; order: number };
export type SelectionState = { scopeKey?: string; active: boolean; items: SelectionItem[] };
export type SelectionAction =
  | { type: 'scope'; key?: string }
  | { type: 'leave'; key: string }
  | { type: 'rebase'; key: string }
  | { type: 'enter' }
  | { type: 'toggle'; item: SelectionItem }
  | { type: 'select-page'; items: SelectionItem[] }
  | { type: 'remove-applied'; ids: readonly string[] }
  | { type: 'finish' };

export const initialSelectionState: SelectionState = { active: false, items: [] };

export function selectionScopeKey(scope: SelectionScope): string {
  if (scope.kind === 'folder') return `folder:${scope.id}`;
  if (scope.kind === 'playlist') return `playlist:${scope.id}@${scope.revision}`;
  if (scope.kind === 'favorites') return 'favorites:songs';
  return `search:${scope.musicFolderId ?? ''}:${scope.query.trim()}`;
}

function normalized(items: readonly SelectionItem[]): SelectionItem[] {
  const byId = new Map<string, SelectionItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || item.order < existing.order) byId.set(item.id, item);
  }
  return [...byId.values()].sort((left, right) => left.order - right.order);
}

export function selectionReducer(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'scope':
      return state.scopeKey === action.key
        ? state
        : { ...initialSelectionState, ...(action.key ? { scopeKey: action.key } : {}) };
    case 'leave':
      return state.scopeKey === action.key ? initialSelectionState : state;
    case 'rebase':
      return { ...state, scopeKey: action.key };
    case 'enter':
      return { ...state, active: true };
    case 'toggle':
      return state.items.some(({ id }) => id === action.item.id)
        ? { ...state, items: state.items.filter(({ id }) => id !== action.item.id) }
        : { ...state, items: normalized([...state.items, action.item]) };
    case 'select-page':
      return { ...state, items: normalized([...state.items, ...action.items]) };
    case 'remove-applied': {
      const applied = new Set(action.ids);
      return { ...state, items: state.items.filter(({ id }) => !applied.has(id)) };
    }
    case 'finish':
      return { ...state, active: false, items: [] };
  }
}
