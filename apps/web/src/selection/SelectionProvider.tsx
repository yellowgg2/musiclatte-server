import {
  createContext,
  useContext,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import {
  initialSelectionState,
  selectionReducer,
  type SelectionAction,
  type SelectionState,
} from './model';

const SelectionContext = createContext<
  { state: SelectionState; dispatch: Dispatch<SelectionAction> } | undefined
>(undefined);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(selectionReducer, initialSelectionState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection() {
  const selection = useContext(SelectionContext);
  if (!selection) throw new Error('SelectionProvider is missing');
  return selection;
}
