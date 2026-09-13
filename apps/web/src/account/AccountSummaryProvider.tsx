import type { AccountSummaryResponse, ApiErrorCode } from '@musiclatte/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError } from '../auth/client';
import { createAccountSummaryClient } from './client';

export interface AccountSummaryState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  summary?: AccountSummaryResponse;
  error?: ApiErrorCode;
}

interface AccountSummaryContextValue {
  state: AccountSummaryState;
  refresh: () => void;
}

const fallback: AccountSummaryContextValue = {
  state: { status: 'idle' },
  refresh: () => undefined,
};
const AccountSummaryContext = createContext<AccountSummaryContextValue>(fallback);

export function AccountSummaryProvider({
  scope,
  enabled,
  fetcher,
  apiOrigin,
  onUnauthenticated,
  children,
}: {
  scope: string;
  enabled: boolean;
  fetcher: typeof fetch;
  apiOrigin: string;
  onUnauthenticated: () => void;
  children: ReactNode;
}) {
  const client = useMemo(
    () => createAccountSummaryClient({ fetcher, apiOrigin }),
    [fetcher, apiOrigin],
  );
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AccountSummaryState>({ status: enabled ? 'loading' : 'idle' });
  const stateScope = useRef(scope);
  const generation = useRef(0);
  const unauthenticated = useRef(onUnauthenticated);
  unauthenticated.current = onUnauthenticated;

  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const requestGeneration = ++generation.current;
    const sameScope = stateScope.current === scope;
    stateScope.current = scope;
    if (!enabled) {
      setState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setState((previous) => ({
      status: 'loading',
      ...(sameScope && previous.summary ? { summary: previous.summary } : {}),
    }));
    void client.read(controller.signal).then(
      (summary) => {
        if (!controller.signal.aborted && generation.current === requestGeneration)
          setState({ status: 'ready', summary });
      },
      (error) => {
        if (controller.signal.aborted || generation.current !== requestGeneration) return;
        const code = error instanceof ApiError ? error.code : 'upstream_unavailable';
        if (code === 'unauthenticated') unauthenticated.current();
        else
          setState((previous) => ({
            status: 'error',
            error: code,
            ...(previous.summary ? { summary: previous.summary } : {}),
          }));
      },
    );
    return () => controller.abort();
  }, [attempt, client, enabled, scope]);

  return (
    <AccountSummaryContext.Provider
      value={{
        state: stateScope.current === scope ? state : { status: enabled ? 'loading' : 'idle' },
        refresh,
      }}
    >
      {children}
    </AccountSummaryContext.Provider>
  );
}

export function useAccountSummary() {
  return useContext(AccountSummaryContext);
}

export function useInvalidateAccountSummary() {
  return useAccountSummary().refresh;
}
