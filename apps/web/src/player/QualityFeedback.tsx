import { messages, type Locale } from '../i18n';
import { Action } from '../design/components/Action';
import { usePlayer } from './PlayerProvider';
import styles from './Player.module.css';
export function QualityFeedback({ locale }: { locale: Locale }) {
  const p = usePlayer();
  const q = p.quality;
  const copy = messages[locale];
  if (!q.resolving && !q.reason && !q.error) return null;
  return (
    <div className={styles.qualityFeedback}>
      <p role={q.error ? 'alert' : 'status'}>
        {
          copy[
            q.resolving
              ? 'quality.resolving'
              : q.reason
                ? (`quality.reason.${q.reason}` as const)
                : 'quality.error'
          ]
        }
      </p>
      {q.canRetryOriginal && (
        <Action variant="secondary" busy={q.resolving} onClick={p.retryOriginal}>
          {copy['quality.retryOriginal']}
        </Action>
      )}
    </div>
  );
}
export function CurrentQuality({ locale }: { locale: Locale }) {
  const q = usePlayer().quality.active;
  return q ? (
    <small>
      {messages[locale]['quality.current']}: {messages[locale][`quality.${q.effectiveQuality}`]}
    </small>
  ) : null;
}
