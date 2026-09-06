import { MusicRow } from '../music/components/MusicRow';
import { librarySongs } from './library-fixtures';
import { useEffect, useState } from 'react';
import { Action } from '../design/components/Action';
import { IconAction } from '../design/components/IconAction';
import { TextField } from '../design/components/TextField';
import { StatusSurface } from '../design/components/StatusSurface';
import { Artwork } from '../design/components/Artwork';
import { messages, type Locale } from '../i18n';
import {
  galleryBrokenCover,
  galleryCover,
  galleryFixtureId,
  gallerySwatches,
} from './gallery-fixtures';
import '../design/global.css';
import styles from './Gallery.module.css';

export function Gallery() {
  const [locale, setLocale] = useState<Locale>('ko');
  const [feedback, setFeedback] = useState(false);
  const [favorite, setFavorite] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [previewSongId, setPreviewSongId] = useState<string | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [selectedSongIds, setSelectedSongIds] = useState<string[]>([]);
  const t = messages[locale];
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = `Musiclatte · ${t['gallery.gallery']}`;
  }, [locale, t]);
  const respond = () => setFeedback(true);
  return (
    <div className={styles.page} data-fixture={galleryFixtureId}>
      <a className={styles.skip} href="#foundations">
        {t['gallery.skip']}
      </a>
      <header className={styles.header}>
        <a className={styles.brand} href="#top">
          <span className={styles.brandMark} aria-hidden="true">
            ♪
          </span>
          musiclatte<span className={styles.brandDetail}>/ {t['gallery.gallery']}</span>
        </a>
        <div className={styles.languages} role="group" aria-label={t['gallery.language']}>
          <Action
            variant={locale === 'ko' ? 'primary' : 'quiet'}
            aria-pressed={locale === 'ko'}
            onClick={() => setLocale('ko')}
            lang="ko"
          >
            한국어
          </Action>
          <Action
            variant={locale === 'en' ? 'primary' : 'quiet'}
            aria-pressed={locale === 'en'}
            onClick={() => setLocale('en')}
            lang="en"
          >
            English
          </Action>
        </div>
      </header>
      <main id="top" className={styles.main}>
        <div className={styles.intro}>
          <div>
            <p className={styles.eyebrow}>{t['gallery.eyebrow']}</p>
            <h1>{t['gallery.heading']}</h1>
            <p className={styles.lead}>{t['gallery.intro']}</p>
          </div>
          <span className={styles.badge}>{t['gallery.baseline']}</span>
        </div>
        <section id="foundations" className={styles.section}>
          <div className={styles.sectionHeading}>
            <span className={styles.number}>01</span>
            <div>
              <h2>{t['gallery.foundations']}</h2>
              <p>{t['gallery.foundationNote']}</p>
            </div>
          </div>
          <div className={styles.foundationGrid}>
            <div>
              <div className={styles.swatches}>
                {gallerySwatches.map((key) => (
                  <div key={key}>
                    <div className={`${styles.swatch} ${styles[key]}`} />
                    <span>{t[`gallery.${key}`]}</span>
                  </div>
                ))}
              </div>
              <p className={styles.statusColors}>
                <span>✓</span>
                <span>△</span>
                <span>!</span>
                <span>i</span>
                {t['gallery.statusColors']}
              </p>
            </div>
            <div className={styles.typeSample}>
              <h3>{t['gallery.sampleTitle']}</h3>
              <p>{t['gallery.sampleBody']}</p>
              <small>{t['gallery.sampleMeta']}</small>
              <div className={styles.spacing} aria-hidden="true">
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
          </div>
        </section>
        <div className={styles.twoColumns}>
          <section id="action" className={styles.section}>
            <div className={styles.sectionHeading}>
              <span className={styles.number}>02</span>
              <div>
                <h2>{t['gallery.actions']}</h2>
                <p>{t['gallery.actionNote']}</p>
              </div>
            </div>
            <div className={styles.actions}>
              <Action onClick={respond}>{t['gallery.primary']}</Action>
              <Action variant="secondary" onClick={respond}>
                {t['gallery.secondary']}
              </Action>
              <Action variant="quiet" onClick={respond}>
                {t['gallery.quiet']}
              </Action>
              <Action variant="destructive" onClick={respond}>
                {t['gallery.destructive']}
              </Action>
              <Action busy>{t['gallery.busy']}</Action>
              <Action disabled>{t['gallery.disabled']}</Action>
              <Action variant="secondary" onClick={respond}>
                {t['gallery.longAction']}
              </Action>
            </div>
            <p className={styles.feedback} role="status">
              {t[feedback ? 'gallery.feedbackDone' : 'gallery.feedbackIdle']}
            </p>
          </section>
          <section id="icon-action" className={styles.section}>
            <div className={styles.sectionHeading}>
              <span className={styles.number}>03</span>
              <div>
                <h2>{t['gallery.icons']}</h2>
                <p>{t['gallery.iconNote']}</p>
              </div>
            </div>
            <div className={styles.iconRow}>
              <IconAction
                label={t['gallery.favorite']}
                pressed={favorite}
                onClick={() => setFavorite(!favorite)}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill={favorite ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" />
                </svg>
              </IconAction>
              <IconAction label={t['gallery.next']} disabled>
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                >
                  <path d="m6 5 10 7L6 19Z M18 5v14" />
                </svg>
              </IconAction>
              <span role="status">
                {t[favorite ? 'gallery.favoriteOn' : 'gallery.favoriteOff']}
              </span>
            </div>
          </section>
        </div>
        <section id="text-field" className={styles.section}>
          <div className={styles.sectionHeading}>
            <span className={styles.number}>04</span>
            <div>
              <h2>{t['gallery.fields']}</h2>
              <p>{t['gallery.fieldNote']}</p>
            </div>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setSubmitted(true);
            }}
          >
            <div className={styles.fieldGrid}>
              <TextField
                label={t['gallery.username']}
                help={t['gallery.help']}
                placeholder={t['gallery.placeholder']}
                autoComplete="off"
              />
              <TextField
                label={t['gallery.requiredName']}
                error={t['gallery.fieldError']}
                defaultValue="musiclover"
              />
              <TextField label={t['gallery.unavailable']} disabled defaultValue="musiclover" />
            </div>
            <div className={styles.formFooter}>
              <Action type="submit" variant="secondary">
                {t['gallery.submit']}
              </Action>
              <p role="status">{submitted && t['gallery.submitted']}</p>
            </div>
          </form>
        </section>
        <section id="status-surface" className={styles.section}>
          <div className={styles.sectionHeading}>
            <span className={styles.number}>05</span>
            <div>
              <h2>{t['gallery.states']}</h2>
              <p>{t['gallery.stateNote']}</p>
            </div>
          </div>
          <div className={styles.stateGrid}>
            <StatusSurface
              state="loading"
              title={t['gallery.loadingTitle']}
              description={t['gallery.loadingDescription']}
            />
            <StatusSurface
              state="empty"
              title={t['gallery.emptyTitle']}
              description={t['gallery.emptyDescription']}
              action={
                <Action variant="secondary" onClick={respond}>
                  {t['gallery.secondary']}
                </Action>
              }
            />
            <StatusSurface
              state={recovered ? 'empty' : 'error'}
              title={t[recovered ? 'gallery.recoveredTitle' : 'gallery.errorTitle']}
              description={
                t[recovered ? 'gallery.recoveredDescription' : 'gallery.errorDescription']
              }
              action={
                !recovered && (
                  <Action variant="secondary" onClick={() => setRecovered(true)}>
                    {t['gallery.retry']}
                  </Action>
                )
              }
            />
          </div>
        </section>
        <section id="artwork" className={styles.section}>
          <div className={styles.sectionHeading}>
            <span className={styles.number}>06</span>
            <div>
              <h2>{t['gallery.artwork']}</h2>
              <p>{t['gallery.artworkNote']}</p>
            </div>
          </div>
          <div className={styles.artGrid}>
            {(['available', 'loading', 'missing', 'failure'] as const).map((state) => (
              <figure key={state}>
                <Artwork
                  alt={t['gallery.coverAlt']}
                  {...(state === 'available'
                    ? { src: galleryCover }
                    : state === 'failure'
                      ? { src: galleryBrokenCover }
                      : state === 'loading'
                        ? { loading: true }
                        : {})}
                />
                <figcaption>{t[`gallery.${state}`]}</figcaption>
              </figure>
            ))}
          </div>
        </section>
        <section id="music-row" className={styles.section}>
          <h2>{t['music.songs']}</h2>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {librarySongs.map((song) => (
              <MusicRow
                key={song.id}
                song={song}
                songs={librarySongs}
                locale={locale}
                current={previewSongId === song.id}
                playbackStatus={previewPlaying && previewSongId === song.id ? 'playing' : 'paused'}
                onActivate={({ song: selected }) => {
                  setPreviewSongId(selected.id);
                  setPreviewPlaying(true);
                }}
                onPause={() => setPreviewPlaying(false)}
                onResume={() => setPreviewPlaying(true)}
                selected={selectedSongIds.includes(song.id)}
                onSelect={() =>
                  setSelectedSongIds((current) =>
                    current.includes(song.id)
                      ? current.filter((id) => id !== song.id)
                      : [...current, song.id],
                  )
                }
              />
            ))}
          </ul>
        </section>
        <footer className={styles.footer}>
          <span>musiclatte</span>
          <p>{t['gallery.footer']}</p>
        </footer>
      </main>
    </div>
  );
}
