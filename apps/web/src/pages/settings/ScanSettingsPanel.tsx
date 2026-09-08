import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApiErrorCode, ScanSettings } from '@musiclatte/contracts';
import { createScanClient } from '../../scan/client';
import { errorCode } from '../../auth/client';
import { Action } from '../../design/components/Action';
import { TextField } from '../../design/components/TextField';
import { StatusSurface } from '../../design/components/StatusSurface';
import { messages, type Locale } from '../../i18n';
import shell from '../../app/Shell.module.css';
import styles from './ScanSettingsPanel.module.css';
export function ScanSettingsPanel({
  locale,
  fetcher,
  apiOrigin,
  csrfToken,
  onUnauthenticated,
  onRetryCapabilities,
}: {
  locale: Locale;
  fetcher: typeof fetch;
  apiOrigin: string;
  csrfToken: string;
  onUnauthenticated: () => void;
  onRetryCapabilities: () => void;
}) {
  const copy = messages[locale];
  const client = useMemo(() => createScanClient(fetcher, apiOrigin), [fetcher, apiOrigin]);
  const [value, setValue] = useState<ScanSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [minutes, setMinutes] = useState('360');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'requested' | null>(null);
  const [error, setError] = useState<ApiErrorCode | null>(null);
  const life = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const generation = useRef(0);
  const blocked = useRef(false);
  const callbacks = useRef({ onUnauthenticated, onRetryCapabilities });
  callbacks.current = { onUnauthenticated, onRetryCapabilities };
  function fail(reason: unknown) {
    const code = errorCode(reason);
    setError(code);
    if (code === 'unauthenticated' || code === 'forbidden') blocked.current = true;
    if (code === 'unauthenticated') callbacks.current.onUnauthenticated();
    if (code === 'forbidden') callbacks.current.onRetryCapabilities();
  }
  async function load(signal: AbortSignal) {
    blocked.current = false;
    try {
      const [settings, status] = await Promise.all([
        client.settings(signal),
        client.status(signal),
      ]);
      if (signal.aborted) return;
      setValue(settings);
      setEnabled(settings.enabled);
      setMinutes(String(settings.intervalMinutes));
      setScanning(status);
      setError(null);
    } catch (reason) {
      if (!signal.aborted) fail(reason);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    void load(controller.signal);
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const serial = generation.current;
      try {
        if (!lock.current && !blocked.current && document.visibilityState !== 'hidden') {
          const [status, settings] = await Promise.all([
            client.status(controller.signal),
            client.settings(controller.signal),
          ]);
          if (!controller.signal.aborted && generation.current === serial) {
            setScanning(status);
            setValue(settings);
          }
        }
      } catch (reason) {
        if (!controller.signal.aborted && generation.current === serial) fail(reason);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 5000);
      }
    };
    timer = setTimeout(() => void poll(), 5000);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [client]);
  async function act(kind: 'save' | 'start') {
    const signal = life.current?.signal;
    if (!signal || lock.current) return;
    lock.current = true;
    generation.current++;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (kind === 'save') {
        const result = await client.save(
          { enabled, intervalMinutes: Number(minutes) },
          csrfToken,
          signal,
        );
        if (!signal.aborted) {
          setValue(result);
          setNotice('saved');
        }
      } else {
        await client.start(csrfToken, signal);
        if (!signal.aborted) {
          setScanning(true);
          setNotice('requested');
        }
      }
    } catch (reason) {
      if (!signal.aborted) fail(reason);
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }
  const valid = /^\d+$/.test(minutes) && Number(minutes) >= 15 && Number(minutes) <= 10080;
  const dirty = value && (enabled !== value.enabled || Number(minutes) !== value.intervalMinutes);
  return (
    <section className={shell.section} aria-labelledby="scan-heading">
      <div className={styles.heading}>
        <div>
          <h2 id="scan-heading">{copy['scan.title']}</h2>
          <p className={shell.secondary}>{copy['scan.description']}</p>
        </div>
        <Action
          variant="secondary"
          disabled={!value || scanning || busy}
          onClick={() => void act('start')}
        >
          {copy[scanning ? 'scan.scanning' : 'scan.now']}
        </Action>
      </div>
      {!value && !error && <p role="status">{copy['scan.loading']}</p>}
      {value && (
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void act('save');
          }}
        >
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            {copy['scan.automatic']}
          </label>
          <TextField
            type="number"
            label={copy['scan.interval']}
            min={15}
            max={10080}
            step={1}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            disabled={busy}
            help={copy['scan.intervalHelp']}
            {...(!valid ? { error: copy['scan.invalid'] } : {})}
          />
          <Action type="submit" busy={busy} disabled={!valid || !dirty || busy}>
            {copy['scan.save']}
          </Action>
          <p className={shell.secondary}>{copy['scan.serverHelp']}</p>
          {value.enabled && value.nextRunAt && (
            <p>
              {copy['scan.next']} {new Date(value.nextRunAt).toLocaleString(locale)}
            </p>
          )}
          {value.lastError && (
            <p role="status">
              {copy[value.lastError === 'forbidden' ? 'scan.permissionLost' : 'scan.lastFailed']}
            </p>
          )}
        </form>
      )}
      {notice && <p role="status">{copy[notice === 'saved' ? 'scan.saved' : 'scan.requested']}</p>}
      {error && (
        <StatusSurface
          state="error"
          title={copy['status.error']}
          description={copy[`error.${error}`]}
          action={
            <Action
              variant="secondary"
              onClick={() => {
                const signal = life.current?.signal;
                if (signal) void load(signal);
              }}
            >
              {copy['scan.retry']}
            </Action>
          }
        />
      )}
    </section>
  );
}
