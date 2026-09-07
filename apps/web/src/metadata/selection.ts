import { useEffect, useRef } from 'react';
import { useSelection } from '../selection/SelectionProvider';
import type { SelectionItem } from '../selection/model';
import { useMetadataSync } from './MetadataSyncProvider';

/** Only a refreshed loaded page can remove a previously loaded selection; pagination cannot. */
export function useMetadataSelectionRebase({
  key,
  scope,
  data,
  items,
  ready,
}: {
  key: string;
  scope?: string;
  data: unknown;
  items: readonly SelectionItem[];
  ready: boolean;
}) {
  const metadata = useMetadataSync();
  const selection = useSelection();
  const previous = useRef<
    | {
        key: string;
        scope: string;
        data: unknown;
        items: readonly SelectionItem[];
        version: number;
        client: typeof metadata.client;
      }
    | undefined
  >(undefined);
  useEffect(() => {
    if (!ready || !scope || !data) return;
    const before = previous.current;
    if (before?.data === data && before.key === key && before.client === metadata.client) return;
    previous.current = {
      key,
      scope,
      data,
      items,
      version: metadata.state.version,
      client: metadata.client,
    };
    if (
      !before ||
      before.key !== key ||
      before.client !== metadata.client ||
      before.version === metadata.state.version ||
      selection.state.scopeKey !== before.scope
    )
      return;
    const currentIds = new Set(items.map((item) => item.id));
    selection.dispatch({ type: 'rebase', key: scope, order: items });
    selection.dispatch({
      type: 'remove-applied',
      ids: before.items.filter((item) => !currentIds.has(item.id)).map((item) => item.id),
    });
  }, [
    key,
    scope,
    data,
    items,
    ready,
    metadata.client,
    metadata.state.version,
    selection.dispatch,
    selection.state.scopeKey,
  ]);
}
