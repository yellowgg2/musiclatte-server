import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArtistInfoResponse } from '@musiclatte/contracts';
import { Action } from '../../design/components/Action';
import { Artwork } from '../../design/components/Artwork';
import { StatusSurface } from '../../design/components/StatusSurface';
import { errorCode } from '../../auth/client';
import { createArtistInfoClient } from '../../music/artist-info-client';
import { messages, type Locale } from '../../i18n';
import styles from './ArtistInfo.module.css';

export function ArtistInfoPanel({
  artistId,
  artistName,
  base,
  locale,
  fetcher,
  apiOrigin,
  coverUrl,
  onUnauthenticated,
}: {
  artistId: string;
  artistName: string;
  base: string;
  locale: Locale;
  fetcher: typeof fetch;
  apiOrigin: string;
  coverUrl: (id: string) => string;
  onUnauthenticated: () => void;
}) {
  const client = useMemo(() => createArtistInfoClient(fetcher, apiOrigin), [fetcher, apiOrigin]);
  const generation = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [state, setState] = useState<{
    loading: boolean;
    data?: ArtistInfoResponse;
    error?: string;
  }>({ loading: true });
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setExpanded(false);
    setState({ loading: true });
    void client.read(artistId, controller.signal).then(
      (data) => {
        if (generation.current === current) setState({ loading: false, data });
      },
      (error) => {
        if (generation.current !== current) return;
        const code = errorCode(error);
        if (code === 'unauthenticated') return onUnauthenticated();
        setState({ loading: false, error: code });
      },
    );
    return () => controller.abort();
  }, [artistId, attempt, client, onUnauthenticated]);
  const copy = messages[locale];
  if (state.loading)
    return (
      <StatusSurface
        state="loading"
        title={copy['artistInfo.loading']}
        description={copy['artistInfo.loadingHelp']}
      />
    );
  if (state.error)
    return (
      <StatusSurface
        state="error"
        title={copy['artistInfo.error']}
        description={copy['artistInfo.errorHelp']}
        action={
          <Action variant="secondary" onClick={() => setAttempt((value) => value + 1)}>
            {copy['status.retry']}
          </Action>
        }
      />
    );
  const data = state.data!;
  if (data.state === 'empty')
    return (
      <StatusSurface
        state="empty"
        title={copy['artistInfo.empty']}
        description={copy['artistInfo.emptyHelp']}
      />
    );
  const long = (data.biography?.length ?? 0) > 280;
  return (
    <section className={styles.panel} aria-labelledby="artist-information-title">
      <Artwork
        alt={copy['artistInfo.artwork'].replace('{name}', artistName)}
        {...(data.coverArtId ? { src: coverUrl(data.coverArtId) } : {})}
      />
      <div className={styles.content}>
        <h2 id="artist-information-title">{copy['artistInfo.title']}</h2>
        {data.biography && (
          <>
            <p className={!expanded && long ? styles.collapsed : undefined}>{data.biography}</p>
            {long && (
              <Action variant="quiet" onClick={() => setExpanded((value) => !value)}>
                {copy[expanded ? 'artistInfo.less' : 'artistInfo.more']}
              </Action>
            )}
          </>
        )}
        {data.similarArtists.length > 0 && (
          <section className={styles.related} aria-labelledby="related-artists-title">
            <h3 id="related-artists-title">{copy['artistInfo.related']}</h3>
            <ul>
              {data.similarArtists.map((artist) => (
                <li key={artist.id}>
                  <a href={`${base}music/artists/${encodeURIComponent(artist.id)}`}>
                    {artist.name}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
}
