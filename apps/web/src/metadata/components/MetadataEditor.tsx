import { useEffect, useId, useRef, useState } from 'react';
import type {
  MetadataJob,
  MetadataJobRequest,
  MetadataPatch,
  MetadataSnapshot,
  MetadataValues,
} from '@musiclatte/contracts';
import { Action } from '../../design/components/Action';
import { TextField } from '../../design/components/TextField';
import { Artwork } from '../../design/components/Artwork';
import { messages, type Locale } from '../../i18n';
import { ApiError } from '../../auth/client';
import type { MetadataClient } from '../client';
import { commonValue } from '../bulk';
import { newPlaylistOperationId } from '../../playlists/operation-id';
import { useMetadataFocus } from '../modal-focus';
import fields from '../../design/components/TextField.module.css';
import styles from './MetadataOverlay.module.css';

type Field = keyof MetadataValues;
const names: Field[] = ['title', 'artist', 'album', 'albumArtist', 'trackNumber', 'year', 'genre'];
export function MetadataEditor({
  snapshot,
  bulk,
  locale,
  client,
  csrfToken,
  apiOrigin,
  canLyrics,
  onSubmitted,
  onClose,
  onUnauthenticated,
}: {
  snapshot: MetadataSnapshot;
  bulk?: {
    snapshots: MetadataSnapshot[];
    occurrenceCount: number;
    fields: readonly string[];
    excluded?: string[];
  };
  locale: Locale;
  client: MetadataClient;
  csrfToken: string;
  apiOrigin: string;
  canLyrics: boolean;
  onSubmitted: (job: MetadataJob) => void;
  onClose: () => void;
  onUnauthenticated: () => void;
}) {
  const copy = messages[locale];
  const dialog = useRef<HTMLDivElement>(null);
  const uid = useId();
  const mixed = new Set<Field>(
    bulk
      ? names.filter(
          (field) => commonValue(bulk.snapshots.map((item) => item.values[field])).kind === 'mixed',
        )
      : [],
  );
  const initialValues = Object.fromEntries(
    names.map((field) => [
      field,
      mixed.has(field)
        ? Array.isArray(snapshot.values[field])
          ? []
          : null
        : snapshot.values[field],
    ]),
  ) as unknown as MetadataValues;
  const [values, setValues] = useState(() => structuredClone(initialValues));
  const [touched, setTouched] = useState<Set<Field>>(() => new Set());
  const supported = (field: keyof MetadataPatch) =>
    bulk
      ? bulk.fields.includes(field) &&
        bulk.snapshots.every((item) => item.supportedFields.includes(field))
      : snapshot.supportedFields.includes(field);
  const [cleared, setCleared] = useState<Set<Field>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const activeRequest = useRef(false);
  const mounted = useRef(true);
  const [review, setReview] = useState<MetadataJobRequest>();
  const [uncertain, setUncertain] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const fronts = snapshot.coverFrames.filter((frame) => frame.pictureType === 3);
  const [coverTarget, setCoverTarget] = useState(
    fronts.length === 1 ? fronts[0]!.frameId : fronts.length === 0 ? 'new' : '',
  );
  const [coverMode, setCoverMode] = useState<'keep' | 'set' | 'clear'>('keep');
  const [cover, setCover] = useState<File>();
  const [objectUrl, setObjectUrl] = useState('');
  const [lyricsTarget, setLyricsTarget] = useState(
    snapshot.lyricsFrames.length === 1 ? '0' : 'new',
  );
  const initialLyrics = snapshot.lyricsFrames.length === 1 ? snapshot.lyricsFrames[0] : undefined;
  const [language, setLanguage] = useState(initialLyrics?.selector.language ?? 'und');
  const [description, setDescription] = useState(initialLyrics?.selector.description ?? '');
  const [lyricsText, setLyricsText] = useState(initialLyrics?.text ?? '');
  const [lyricsMode, setLyricsMode] = useState<'keep' | 'set' | 'clear'>('keep');
  const [sourceReference, setSourceReference] = useState('');
  const [usageBasis, setUsageBasis] = useState('');
  useMetadataFocus(dialog, onClose, busy);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!cover) {
      setObjectUrl('');
      const input = dialog.current?.querySelector<HTMLInputElement>('input[type="file"]');
      if (input) input.value = '';
      return;
    }
    const url = URL.createObjectURL(cover);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cover]);
  useEffect(() => {
    if (review) dialog.current?.querySelector<HTMLElement>('[role="region"]')?.focus();
  }, [review]);
  function update(field: Field, value: string | string[] | null) {
    setTouched((previous) => new Set(previous).add(field));
    setValues((previous) => ({ ...previous, [field]: value }));
    setCleared((previous) => {
      const next = new Set(previous);
      next.delete(field);
      return next;
    });
    setErrors((previous) => ({ ...previous, [field]: '' }));
  }
  function buildPatch() {
    const patch: MetadataPatch = {};
    const nextErrors: Record<string, string> = {};
    for (const field of names) {
      if (!supported(field)) continue;
      if (bulk && !touched.has(field) && !cleared.has(field)) continue;
      if (cleared.has(field)) {
        if (
          mixed.has(field) ||
          JSON.stringify(snapshot.values[field]) !==
            JSON.stringify(Array.isArray(values[field]) ? [] : null)
        )
          Object.assign(patch, { [field]: { op: 'clear' } });
        continue;
      }
      const value = values[field];
      if (!mixed.has(field) && JSON.stringify(value) === JSON.stringify(snapshot.values[field]))
        continue;
      const entries = Array.isArray(value) ? value : [value];
      if (
        !entries.length ||
        entries.length > 32 ||
        entries.some((item) => !item?.trim() || item.length > 4096) ||
        (field === 'year' && !/^\d{4}$/.test(String(value))) ||
        (field === 'trackNumber' &&
          (!/^[1-9]\d*(\/[1-9]\d*)?$/.test(String(value)) || String(value).length > 16))
      ) {
        nextErrors[field] = copy['metadata.invalid'];
        continue;
      }
      Object.assign(patch, { [field]: { op: 'set', value } });
    }
    if (coverMode !== 'keep' && supported('cover')) {
      const frame = fronts.find((item) => item.frameId === coverTarget);
      if (!coverTarget || (coverMode === 'clear' && !frame))
        nextErrors.cover = copy['metadata.coverSelection'];
      else if (coverMode === 'clear' && frame)
        patch.cover = { op: 'clear', selector: { kind: 'front', description: frame.description } };
      else if (
        !cover ||
        !['image/jpeg', 'image/png'].includes(cover.type) ||
        !cover.size ||
        cover.size > 8 * 1024 * 1024
      )
        nextErrors.cover = copy['metadata.invalidCover'];
    }
    if (lyricsMode !== 'keep' && canLyrics && supported('lyrics')) {
      if (
        !/^[a-z]{3}$/.test(language) ||
        description.length > 256 ||
        (lyricsMode === 'set' && (!lyricsText.trim() || lyricsText.length > 100000))
      )
        nextErrors.lyrics = copy['metadata.invalid'];
      else if (lyricsMode === 'clear')
        patch.lyrics = { op: 'clear', selector: { language, description } };
      else {
        const original = snapshot.lyricsFrames[Number(lyricsTarget)];
        if (
          !original ||
          original.text !== lyricsText ||
          original.selector.language !== language ||
          original.selector.description !== description
        )
          patch.lyrics = { op: 'set', selector: { language, description }, text: lyricsText };
      }
    }
    setErrors(nextErrors);
    return { patch, valid: Object.keys(nextErrors).length === 0 };
  }
  function handleError(reason: unknown, save = false) {
    if (reason instanceof ApiError && reason.code === 'unauthenticated') {
      onUnauthenticated();
      return;
    }
    if (!mounted.current || (reason instanceof DOMException && reason.name === 'AbortError'))
      return;
    if (save) setUncertain(true);
    setError(copy[save ? 'metadata.uncertain' : 'metadata.failed']);
  }
  async function prepare() {
    if (activeRequest.current) return;
    const { patch, valid } = buildPatch();
    if (!valid) {
      requestAnimationFrame(() =>
        dialog.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus(),
      );
      return;
    }
    if (!Object.keys(patch).length && coverMode !== 'set') {
      setError(copy['metadata.noChanges']);
      return;
    }
    activeRequest.current = true;
    setBusy(true);
    setError('');
    const targets = (bulk?.snapshots ?? [snapshot]).map((item) => ({
      trackId: item.trackId,
      expectedRevision: item.fileRevision,
    }));
    const options = { csrfToken };
    try {
      if (coverMode === 'set' && cover) {
        // The non-writing preview resolves the authorized library before private upload.
        const scope = await client.preview(
          {
            targets,
            patch: {
              title: snapshot.values.title
                ? { op: 'set', value: snapshot.values.title }
                : { op: 'clear' },
            },
          },
          options,
        );
        const upload = await client.upload(cover, {
          ...options,
          libraryId: scope.libraryId,
          operationId: newPlaylistOperationId(),
        });
        const frame = fronts.find((item) => item.frameId === coverTarget);
        patch.cover = {
          op: 'set',
          uploadId: upload.uploadId,
          selector: frame ? { kind: 'front', description: frame.description } : { kind: 'new' },
        };
      }
      await client.preview({ targets, patch }, options);
      if (mounted.current)
        setReview({
          operationId: newPlaylistOperationId(),
          targets,
          patch,
          ...(sourceReference.trim() ? { sourceReference } : {}),
          ...(usageBasis.trim() ? { usageBasis } : {}),
        });
    } catch (reason) {
      if (coverMode === 'set' && reason instanceof ApiError && reason.code === 'invalid_request')
        setErrors((previous) => ({ ...previous, cover: copy['metadata.invalidCover'] }));
      handleError(reason);
    } finally {
      activeRequest.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function save() {
    if (!review || activeRequest.current || submitted) return;
    activeRequest.current = true;
    setBusy(true);
    setError('');
    try {
      const job = await client.submit(review, { csrfToken });
      if (mounted.current) {
        setSubmitted(true);
        onSubmitted(job);
      }
    } catch (reason) {
      handleError(reason, true);
    } finally {
      activeRequest.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  const frame = fronts.find((item) => item.frameId === coverTarget);
  return (
    <div className={styles.backdrop}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${uid}-heading`}
        className={styles.panel}
      >
        <header className={styles.heading}>
          <h2 id={`${uid}-heading`}>
            {copy[review ? 'metadata.summary' : bulk ? 'metadata.bulkEditor' : 'metadata.editor']}
          </h2>
          <p className={styles.current}>{copy['metadata.intro']}</p>
        </header>
        <div
          className={styles.content}
          role="region"
          aria-label={copy['metadata.editor']}
          tabIndex={0}
        >
          {bulk ? (
            <>
              <p>
                {copy['metadata.occurrences']
                  .replace('{count}', String(bulk.occurrenceCount))
                  .replace('{files}', String(bulk.snapshots.length))}
              </p>
              <ul className={styles.summary}>
                {bulk.snapshots.map((item) => (
                  <li key={item.trackId}>
                    {item.values.title || copy['metadata.empty']}
                    {review && (
                      <small className={styles.current}>
                        {' '}
                        {copy['metadata.revision']}: {item.fileRevision}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
              {Boolean(bulk.excluded?.length) && (
                <p>
                  {copy['metadata.excluded']}: {bulk.excluded!.join(' · ')}
                </p>
              )}
            </>
          ) : (
            <p>{snapshot.values.title || copy['metadata.empty']}</p>
          )}
          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}
          {review ? (
            <>
              <p>
                {copy['metadata.targetCount'].replace(
                  '{count}',
                  String(bulk?.snapshots.length ?? 1),
                )}
              </p>
              <ul className={styles.summary}>
                {Object.entries(review.patch).map(([field, change]) => (
                  <li key={field}>
                    <strong>{copy[`metadata.${field as keyof MetadataPatch}`]}</strong>
                    <p>
                      {change.op === 'clear'
                        ? copy['metadata.cleared']
                        : 'value' in change
                          ? Array.isArray(change.value)
                            ? change.value.join(' · ')
                            : change.value
                          : field === 'lyrics' && 'text' in change
                            ? change.text
                            : copy['metadata.newPreview']}
                    </p>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <fieldset disabled={busy} className={styles.fieldset}>
              {names.map((field) => (
                <section key={field} className={styles.field}>
                  <p className={styles.current}>
                    {copy['metadata.current']}:{' '}
                    {mixed.has(field)
                      ? copy['metadata.mixed']
                      : Array.isArray(snapshot.values[field])
                        ? snapshot.values[field].join(' · ') || copy['metadata.empty']
                        : snapshot.values[field] || copy['metadata.empty']}
                  </p>
                  {!supported(field) ? (
                    <>
                      <strong>{copy[`metadata.${field}`]}</strong>
                      <p>{copy['metadata.readonly']}</p>
                    </>
                  ) : (
                    <>
                      {Array.isArray(values[field]) ? (
                        <>
                          {(values[field] as string[]).map((value, index) => (
                            <div key={index} className={styles.field}>
                              <TextField
                                label={`${copy[`metadata.${field}`]} ${index + 1}`}
                                value={value}
                                disabled={cleared.has(field)}
                                {...(errors[field] ? { error: errors[field] } : {})}
                                onChange={(event) =>
                                  update(
                                    field,
                                    (values[field] as string[]).map((item, position) =>
                                      position === index ? event.target.value : item,
                                    ),
                                  )
                                }
                              />
                              <Action
                                variant="quiet"
                                disabled={cleared.has(field)}
                                onClick={() =>
                                  update(
                                    field,
                                    (values[field] as string[]).filter(
                                      (_, position) => position !== index,
                                    ),
                                  )
                                }
                              >
                                {copy['metadata.removeValue']}
                              </Action>
                            </div>
                          ))}
                          <Action
                            variant="secondary"
                            disabled={(values[field] as string[]).length >= 32}
                            onClick={() => update(field, [...(values[field] as string[]), ''])}
                          >
                            {copy['metadata.addValue']} · {copy[`metadata.${field}`]}
                          </Action>
                        </>
                      ) : (
                        <TextField
                          label={copy[`metadata.${field}`]}
                          value={values[field] ?? ''}
                          disabled={cleared.has(field)}
                          {...(errors[field] ? { error: errors[field] } : {})}
                          {...(field === 'year'
                            ? { help: copy['metadata.yearHelp'] }
                            : field === 'trackNumber'
                              ? { help: copy['metadata.trackHelp'] }
                              : {})}
                          onChange={(event) => update(field, event.target.value)}
                        />
                      )}
                      <div className={styles.actions}>
                        <Action
                          variant="quiet"
                          onClick={() => setCleared((previous) => new Set(previous).add(field))}
                        >
                          {copy['metadata.clear'].replace('{field}', copy[`metadata.${field}`])}
                        </Action>
                        <Action
                          variant="quiet"
                          onClick={() => {
                            update(field, structuredClone(initialValues[field]));
                            setTouched((previous) => {
                              const next = new Set(previous);
                              next.delete(field);
                              return next;
                            });
                          }}
                        >
                          {copy['metadata.undo']}
                        </Action>
                      </div>
                      {cleared.has(field) && <p role="status">{copy['metadata.cleared']}</p>}
                    </>
                  )}
                </section>
              ))}
              {bulk && <p>{copy['metadata.bulkFrames']}</p>}
              {supported('cover') && (
                <section className={styles.field}>
                  <h3>{copy['metadata.cover']}</h3>
                  <label className={fields.field}>
                    {copy['metadata.coverTarget']}
                    <select
                      className={fields.input}
                      value={coverTarget}
                      onChange={(event) => {
                        setCoverTarget(event.target.value);
                        setCoverMode('keep');
                        setCover(undefined);
                      }}
                    >
                      <option value="">{copy['metadata.choose']}</option>
                      {fronts.map((item, index) => (
                        <option key={item.frameId} value={item.frameId}>
                          {item.description || `${copy['metadata.cover']} ${index + 1}`}
                        </option>
                      ))}
                      {!fronts.length && <option value="new">{copy['metadata.newCover']}</option>}
                    </select>
                  </label>
                  {frame && (
                    <div className={styles.artwork}>
                      <Artwork
                        src={`${apiOrigin}${frame.previewUrl}`}
                        alt={copy['metadata.current']}
                      />
                    </div>
                  )}
                  <TextField
                    type="file"
                    accept="image/jpeg,image/png"
                    label={copy['metadata.replace']}
                    help={copy['metadata.coverHelp']}
                    {...(errors.cover ? { error: errors.cover } : {})}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      setCover(file);
                      setCoverMode(file ? 'set' : 'keep');
                    }}
                  />
                  {objectUrl && (
                    <div className={styles.artwork}>
                      <Artwork src={objectUrl} alt={copy['metadata.newPreview']} />
                    </div>
                  )}
                  <div className={styles.actions}>
                    <Action
                      variant="quiet"
                      disabled={!frame}
                      onClick={() => {
                        setCoverMode('clear');
                        setCover(undefined);
                      }}
                    >
                      {copy['metadata.clear'].replace('{field}', copy['metadata.cover'])}
                    </Action>
                    <Action
                      variant="quiet"
                      onClick={() => {
                        setCoverMode('keep');
                        setCover(undefined);
                      }}
                    >
                      {copy['metadata.undo']}
                    </Action>
                  </div>
                  <p role="status">
                    {
                      copy[
                        coverMode === 'keep'
                          ? 'metadata.unchanged'
                          : coverMode === 'clear'
                            ? 'metadata.cleared'
                            : 'metadata.newPreview'
                      ]
                    }
                  </p>
                </section>
              )}
              {canLyrics && supported('lyrics') && (
                <section className={styles.field}>
                  <h3>{copy['metadata.lyrics']}</h3>
                  <label className={fields.field}>
                    {copy['metadata.lyricsTarget']}
                    <select
                      className={fields.input}
                      value={lyricsTarget}
                      onChange={(event) => {
                        const value = event.target.value;
                        const entry = snapshot.lyricsFrames[Number(value)];
                        setLyricsTarget(value);
                        setLanguage(entry?.selector.language ?? 'und');
                        setDescription(entry?.selector.description ?? '');
                        setLyricsText(entry?.text ?? '');
                        setLyricsMode('keep');
                      }}
                    >
                      <option value="new">{copy['metadata.newLyrics']}</option>
                      {snapshot.lyricsFrames.map((item, index) => (
                        <option key={index} value={String(index)}>
                          {item.selector.language} ·{' '}
                          {item.selector.description || copy['metadata.lyrics']}
                        </option>
                      ))}
                    </select>
                  </label>
                  <TextField
                    label={copy['metadata.language']}
                    value={language}
                    readOnly={lyricsTarget !== 'new'}
                    help={copy['metadata.languageHelp']}
                    onChange={(event) => {
                      setLanguage(event.target.value);
                      setLyricsMode('set');
                    }}
                  />
                  <TextField
                    label={copy['metadata.description']}
                    value={description}
                    readOnly={lyricsTarget !== 'new'}
                    maxLength={256}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      setLyricsMode('set');
                    }}
                  />
                  <label className={fields.field} htmlFor={`${uid}-lyrics`}>
                    {copy['metadata.lyricsText']}
                    <textarea
                      id={`${uid}-lyrics`}
                      className={fields.input}
                      rows={8}
                      value={lyricsText}
                      aria-invalid={Boolean(errors.lyrics)}
                      aria-describedby={errors.lyrics ? `${uid}-lyrics-error` : undefined}
                      onChange={(event) => {
                        setLyricsText(event.target.value);
                        setLyricsMode('set');
                      }}
                    />
                  </label>
                  {errors.lyrics && (
                    <p id={`${uid}-lyrics-error`} className={styles.error}>
                      {errors.lyrics}
                    </p>
                  )}
                  <div className={styles.actions}>
                    <Action
                      variant="quiet"
                      disabled={lyricsTarget === 'new'}
                      onClick={() => setLyricsMode('clear')}
                    >
                      {copy['metadata.clear'].replace('{field}', copy['metadata.lyrics'])}
                    </Action>
                    <Action
                      variant="quiet"
                      onClick={() => {
                        setLyricsMode('keep');
                        setLyricsText(snapshot.lyricsFrames[Number(lyricsTarget)]?.text ?? '');
                      }}
                    >
                      {copy['metadata.undo']}
                    </Action>
                  </div>
                  <p role="status">
                    {
                      copy[
                        lyricsMode === 'clear'
                          ? 'metadata.cleared'
                          : lyricsMode === 'keep'
                            ? 'metadata.unchanged'
                            : 'metadata.lyrics'
                      ]
                    }
                  </p>
                </section>
              )}
              <TextField
                label={copy['metadata.sourceReference']}
                value={sourceReference}
                maxLength={2048}
                onChange={(event) => setSourceReference(event.target.value)}
              />
              <TextField
                label={copy['metadata.usageBasis']}
                value={usageBasis}
                maxLength={4096}
                onChange={(event) => setUsageBasis(event.target.value)}
              />
            </fieldset>
          )}
          <p role="status">{busy ? copy[review ? 'metadata.saving' : 'metadata.checking'] : ''}</p>
        </div>
        <footer className={styles.footer}>
          <Action variant="quiet" disabled={busy} onClick={onClose}>
            {copy['metadata.cancel']}
          </Action>
          {review && !uncertain && (
            <Action variant="secondary" disabled={busy} onClick={() => setReview(undefined)}>
              {copy['metadata.back']}
            </Action>
          )}
          <Action
            busy={busy}
            disabled={submitted || !snapshot.editable}
            onClick={() => void (review ? save() : prepare())}
          >
            {copy[review ? (uncertain ? 'metadata.resend' : 'metadata.save') : 'metadata.review']}
          </Action>
        </footer>
      </div>
    </div>
  );
}
