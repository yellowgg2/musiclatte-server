import { useEffect, useId, useRef, useState } from 'react';
import type { MetadataSnapshot, MusicEntry } from '@musiclatte/contracts';
import { IconAction } from '../../design/components/IconAction';
import { Action } from '../../design/components/Action';
import { messages } from '../../i18n';
import { ApiError } from '../../auth/client';
import { useMetadataSync, useOrganizationState } from '../MetadataSyncProvider';
import { useMetadataUI } from '../MetadataUIProvider';
import jobStyles from './MetadataJobStatus.module.css';
import styles from './MetadataAction.module.css';

const organizationCopyKeys = {
  loading: 'metadata.organization.loading',
  error: 'metadata.organization.error',
  organized: 'metadata.organization.organized',
  needs_organization: 'metadata.organization.needsOrganization',
  processing: 'metadata.organization.processing',
  attention: 'metadata.organization.attention',
  unknown: 'metadata.organization.unknown',
} as const;

const organizationMarks = {
  loading: '…',
  error: '?',
  needs_organization: '!',
  processing: '…',
  attention: '!',
  unknown: '?',
} as const;

const organizationClassNames = {
  loading: styles.loading,
  error: styles.error,
  organized: '',
  needs_organization: styles.needsOrganization,
  processing: styles.processing,
  attention: styles.attention,
  unknown: styles.unknown,
} as const;

export function MetadataAction({ song }: { song: MusicEntry }) {
  const ui = useMetadataUI();
  const sync = useMetadataSync();
  const organization = useOrganizationState(song.id, ui.canEdit);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [snapshot, setSnapshot] = useState<MetadataSnapshot>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const dismissOutside = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || root.current?.contains(target)) return;
      // The editor owns its modal focus and must return to its still-mounted trigger.
      if (target.closest('[role="dialog"]')) return;
      setExpanded(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !root.current?.contains(event.target as Node)) return;
      event.preventDefault();
      setExpanded(false);
      root.current.querySelector('button')?.focus();
    };
    document.addEventListener('click', dismissOutside);
    document.addEventListener('keydown', dismissEscape);
    return () => {
      document.removeEventListener('click', dismissOutside);
      document.removeEventListener('keydown', dismissEscape);
    };
  }, [expanded]);
  useEffect(() => {
    setSnapshot(undefined);
    setError(false);
    if (!expanded || !ui.canEdit || !sync.client) return;
    const controller = new AbortController();
    setLoading(true);
    void sync.client
      .read(song.id, controller.signal)
      .then(
        (result) => {
          if (!controller.signal.aborted) setSnapshot(result);
        },
        (reason) => {
          if (controller.signal.aborted) return;
          if (reason instanceof ApiError && reason.code === 'unauthenticated')
            ui.onUnauthenticated();
          else setError(true);
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [expanded, attempt, song.id, sync.client, ui.canEdit, ui.onUnauthenticated]);
  if (!ui.canEdit) return null;
  const copy = messages[ui.locale];
  const organizationState =
    organization.phase === 'ready' ? organization.value.state : organization.phase;
  const organizationCopy = copy[organizationCopyKeys[organizationState]];
  const organizationMark =
    organizationState === 'organized' ? undefined : organizationMarks[organizationState];
  return (
    <div ref={root} className={jobStyles.action} data-organization-state={organizationState}>
      <IconAction
        label={`${copy['metadata.options']}: ${song.title} — ${organizationCopy}`}
        className={[styles.trigger, organizationClassNames[organizationState]]
          .filter(Boolean)
          .join(' ')}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
        >
          <path d="M12 5h7M12 12h7M12 19h7" />
          <circle cx="5" cy="5" r="1" />
          <circle cx="5" cy="12" r="1" />
          <circle cx="5" cy="19" r="1" />
        </svg>
        {organizationMark && (
          <span className={styles.mark} data-organization-mark>
            {organizationMark}
          </span>
        )}
      </IconAction>
      {expanded && (
        <div id={id} className={jobStyles.disclosure}>
          <div className={styles.summary} data-organization-summary>
            <span className={styles.summaryMark} aria-hidden="true">
              {organizationState === 'organized' ? '✓' : organizationMark}
            </span>
            <p>{organizationCopy}</p>
            {organization.phase === 'error' && (
              <Action variant="quiet" onClick={organization.retry}>
                {copy['metadata.organization.retry']}
              </Action>
            )}
          </div>
          {loading && <p role="status">{copy['metadata.checking']}</p>}
          {error && (
            <>
              <p role="alert">{copy['metadata.unavailable']}</p>
              <Action variant="quiet" onClick={() => setAttempt((value) => value + 1)}>
                {copy['metadata.retry']}
              </Action>
            </>
          )}
          {!loading && snapshot && (
            <>
              <Action
                variant="secondary"
                disabled={!snapshot.editable}
                onClick={() => ui.open(snapshot)}
              >
                {copy['metadata.action']}
              </Action>
              {!snapshot.editable && (
                <p>
                  {snapshot.reason
                    ? copy[`metadata.error.${snapshot.reason}`]
                    : copy['metadata.readonly']}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
