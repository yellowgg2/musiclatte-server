// @vitest-environment jsdom
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetadataSnapshot } from '@musiclatte/contracts';
import { createMetadataClient } from '../src/metadata/client';

export const snapshot: MetadataSnapshot = {
  schemaVersion: 1,
  trackId: 'song',
  editable: true,
  reason: null,
  format: 'mp3',
  supportedFields: [
    'title',
    'artist',
    'album',
    'albumArtist',
    'trackNumber',
    'year',
    'genre',
    'cover',
    'lyrics',
  ],
  fileRevision: 'revision-1',
  values: {
    title: 'Original title',
    artist: ['Artist one', 'Artist two'],
    album: 'Album',
    albumArtist: [],
    trackNumber: '1/12',
    year: '2020',
    genre: [],
  },
  coverFrames: [],
  lyricsFrames: [
    { selector: { language: 'eng', description: 'Original' }, text: 'Original lyrics' },
  ],
  lastVerifiedAt: 1,
};
async function editorModule() {
  const modules = import.meta.glob('../src/metadata/components/MetadataEditor.tsx');
  expect(Object.keys(modules), 'single editor exists').toHaveLength(1);
  return (await modules[Object.keys(modules)[0]!]!()) as {
    MetadataEditor: typeof import('../src/metadata/components/MetadataEditor').MetadataEditor;
  };
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe('single metadata editor', () => {
  /** Unsaved edits preserve individual values and cancellation has no transport side effects. */
  it('should show actual values and cancel without writing', async () => {
    const { MetadataEditor } = await editorModule();
    const fetcher = vi.fn<typeof fetch>();
    const onClose = vi.fn();
    render(
      <MetadataEditor
        snapshot={snapshot}
        locale="en"
        client={createMetadataClient({ fetcher })}
        csrfToken="synthetic"
        apiOrigin=""
        canLyrics
        onSubmitted={vi.fn()}
        onClose={onClose}
        onUnauthenticated={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Artist 1')).toHaveProperty('value', 'Artist one');
    expect(screen.getByLabelText('Artist 2')).toHaveProperty('value', 'Artist two');
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });
  /** Review submits only actual dirty fields and explicit clear, retaining one operation identity. */
  it('should review only changed fields before accepting a job', async () => {
    const { MetadataEditor } = await editorModule();
    const bodies: Record<string, unknown>[] = [];
    const onSubmitted = vi.fn();
    const fetcher: typeof fetch = async (input, init) => {
      const body = JSON.parse(init!.body as string);
      bodies.push(body);
      if (String(input).endsWith('/metadata-previews'))
        return Response.json({
          schemaVersion: 1,
          libraryId: 'music',
          targetCount: 1,
          changedFields: ['title', 'album'],
          targets: [{ trackId: 'song', fileRevision: 'revision-1' }],
          writeGuaranteed: false,
        });
      return Response.json({
        schemaVersion: 1,
        job: {
          id: 'job',
          libraryId: 'music',
          createdAt: 1,
          status: 'queued',
          kind: 'edit',
          parentJobId: null,
          items: [
            {
              itemId: 'item',
              originalTrackId: 'song',
              currentTrackId: 'song',
              stage: 'queued',
              fileSavedAt: null,
              reflectedAt: null,
              previousRevision: 'revision-1',
              resultRevision: null,
              changedFields: ['title', 'album'],
              errorCode: null,
              recoveryActions: [],
              restoreAvailable: false,
            },
          ],
        },
      });
    };
    render(
      <MetadataEditor
        snapshot={snapshot}
        locale="en"
        client={createMetadataClient({ fetcher })}
        csrfToken="synthetic"
        apiOrigin=""
        canLyrics
        onSubmitted={onSubmitted}
        onClose={vi.fn()}
        onUnauthenticated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'New title' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear Album' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    await screen.findByRole('button', { name: 'Save changes' });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.patch).toEqual({
      title: { op: 'set', value: 'New title' },
      album: { op: 'clear' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledOnce());
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.patch).toEqual(bodies[0]!.patch);
  });
  /** Invalid year and blank typed values never become implicit destructive clears. */
  it('should explain invalid fields and keep submit unavailable', async () => {
    const { MetadataEditor } = await editorModule();
    const fetcher = vi.fn<typeof fetch>();
    render(
      <MetadataEditor
        snapshot={snapshot}
        locale="en"
        client={createMetadataClient({ fetcher })}
        csrfToken="synthetic"
        apiOrigin=""
        canLyrics
        onSubmitted={vi.fn()}
        onClose={vi.fn()}
        onUnauthenticated={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Year'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(screen.getByLabelText('Year').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('Title').getAttribute('aria-invalid')).toBe('true');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

/** Resource editability is loaded only after an explicit action disclosure, with an accessible reason. */
it('should lazily read per-song editability and not expose an enabled edit button early', async () => {
  const modules = import.meta.glob('../src/metadata/components/MetadataAction.tsx');
  expect(Object.keys(modules), 'metadata row action exists').toHaveLength(1);
  const { MetadataAction } = (await modules[
    Object.keys(modules)[0]!
  ]!()) as typeof import('../src/metadata/components/MetadataAction');
  const providers = import.meta.glob('../src/metadata/MetadataUIProvider.tsx');
  const { MetadataUIProvider } = (await providers[
    Object.keys(providers)[0]!
  ]!()) as typeof import('../src/metadata/MetadataUIProvider');
  const { MetadataSyncProvider } = await import('../src/metadata/MetadataSyncProvider');
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ ...snapshot, editable: false, reason: 'read_only' }),
  );
  render(
    <MetadataSyncProvider
      scope="test"
      enabled={false}
      fetcher={fetcher}
      apiOrigin=""
      onUnauthenticated={vi.fn()}
    >
      <MetadataUIProvider
        locale="en"
        base="/"
        apiOrigin=""
        csrfToken="synthetic"
        canEdit
        canLyrics
        canHistory
        onUnauthenticated={vi.fn()}
      >
        <MetadataAction song={{ id: 'song', title: 'Original title', isDir: false }} />
      </MetadataUIProvider>
    </MetadataSyncProvider>,
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Edit music information' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Music information: Original title' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  await screen.findByText('This file is read-only.');
  expect(screen.getByRole('button', { name: 'Edit music information' })).toHaveProperty(
    'disabled',
    true,
  );
});

/** History detail retains saved versus verified states and exposes a durable re-entry link. */
it('should render a pending job without claiming library completion', async () => {
  const modules = import.meta.glob('../src/metadata/components/MetadataJobStatus.tsx');
  expect(Object.keys(modules), 'job status exists').toHaveLength(1);
  const { MetadataJobStatus } = (await modules[
    Object.keys(modules)[0]!
  ]!()) as typeof import('../src/metadata/components/MetadataJobStatus');
  render(
    <MetadataJobStatus
      locale="en"
      job={{
        id: 'job',
        libraryId: 'music',
        createdAt: 1,
        status: 'reflecting',
        kind: 'edit',
        parentJobId: null,
        items: [
          {
            itemId: 'item',
            originalTrackId: 'song',
            currentTrackId: 'song',
            stage: 'reflecting',
            fileSavedAt: 2,
            reflectedAt: null,
            previousRevision: 'r1',
            resultRevision: 'r2',
            changedFields: ['title'],
            errorCode: 'reflection_mismatch',
            recoveryActions: ['recheck'],
            restoreAvailable: true,
          },
        ],
      }}
    />,
  );
  expect(screen.getByText('File saved')).toBeTruthy();
  expect(screen.queryByText('Library verified')).toBeNull();
  expect(
    screen.getByText('The file was saved, but the library still shows previous information.'),
  ).toBeTruthy();
});

/** Uncertain accepted writes keep the original payload and operation ID for safe retry. */
it('should reuse the exact accepted intent after a disconnected save', async () => {
  const { MetadataEditor } = await editorModule();
  const bodies: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/metadata-previews'))
      return Response.json({
        schemaVersion: 1,
        libraryId: 'music',
        targetCount: 1,
        changedFields: ['title'],
        targets: [{ trackId: 'song', fileRevision: 'revision-1' }],
        writeGuaranteed: false,
      });
    bodies.push(init!.body as string);
    throw new Error('Synthetic disconnect');
  };
  render(
    <MetadataEditor
      snapshot={snapshot}
      locale="en"
      client={createMetadataClient({ fetcher })}
      csrfToken="synthetic"
      apiOrigin=""
      canLyrics
      onSubmitted={vi.fn()}
      onClose={vi.fn()}
      onUnauthenticated={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'An intended change' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Resend same save request' }));
  await waitFor(() => expect(bodies).toHaveLength(2));
  expect(bodies[1]).toBe(bodies[0]);
});

/** Clearing one selected USLT entry preserves all other descriptions and its original language. */
it('should clear only the selected existing lyrics entry', async () => {
  const { MetadataEditor } = await editorModule();
  let patch: unknown;
  const fetcher: typeof fetch = async (_input, init) => {
    patch = JSON.parse(init!.body as string).patch;
    return Response.json({
      schemaVersion: 1,
      libraryId: 'music',
      targetCount: 1,
      changedFields: ['lyrics'],
      targets: [{ trackId: 'song', fileRevision: 'revision-1' }],
      writeGuaranteed: false,
    });
  };
  render(
    <MetadataEditor
      snapshot={{
        ...snapshot,
        lyricsFrames: [
          ...snapshot.lyricsFrames,
          {
            selector: { language: 'kor', description: 'Translation' },
            text: 'Synthetic translation',
          },
        ],
      }}
      locale="en"
      client={createMetadataClient({ fetcher })}
      csrfToken="synthetic"
      apiOrigin=""
      canLyrics
      onSubmitted={vi.fn()}
      onClose={vi.fn()}
      onUnauthenticated={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('Lyrics entry'), { target: { value: '1' } });
  expect(screen.getByLabelText('Lyrics language')).toHaveProperty('value', 'kor');
  fireEvent.click(screen.getByRole('button', { name: 'Clear Lyrics' }));
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  await screen.findByRole('button', { name: 'Save changes' });
  expect(patch).toEqual({
    lyrics: { op: 'clear', selector: { language: 'kor', description: 'Translation' } },
  });
});

/** The modal returns focus to a stable list heading when its source row disappears. */
it('should return focus to the page heading when the triggering row is removed', async () => {
  const { MetadataEditor } = await editorModule();
  const host = render(
    <>
      <h1 data-page-heading tabIndex={-1}>
        Music
      </h1>
      <button>Trigger</button>
    </>,
  );
  const trigger = screen.getByRole('button', { name: 'Trigger' });
  trigger.focus();
  const editor = render(
    <MetadataEditor
      snapshot={snapshot}
      locale="en"
      client={createMetadataClient({ fetcher: vi.fn() })}
      csrfToken="synthetic"
      apiOrigin=""
      canLyrics
      onSubmitted={vi.fn()}
      onClose={vi.fn()}
      onUnauthenticated={vi.fn()}
    />,
  );
  host.rerender(
    <h1 data-page-heading tabIndex={-1}>
      Music
    </h1>,
  );
  editor.unmount();
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Music' }));
  host.unmount();
});

/** Normal login redirects must leave SPA link and form navigation active after session restoration. */
it('should navigate from the normal music entry after login', async () => {
  const { Router } = await import('../src/app/Router');
  const user = (await import('@testing-library/user-event')).default.setup();
  window.history.replaceState(null, '', '/login');
  localStorage.setItem('musiclatte.locale', 'en');
  let signedIn = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname.endsWith('/session')) {
      if (init?.method === 'POST') signedIn = true;
      return signedIn
        ? Response.json({
            schemaVersion: 1,
            authScheme: 'cookie',
            username: 'fixture',
            csrfToken: 'csrf',
            expiresAt: Date.now() + 60000,
          })
        : Response.json({ error: { code: 'unauthenticated' } }, { status: 401 });
    }
    if (url.pathname.endsWith('/capabilities'))
      return Response.json({
        schemaVersion: 1,
        instanceId: 'fixture',
        revision: 'r1',
        features: {
          'music.browse': { supported: true, permission: 'allowed', availability: 'available' },
        },
      });
    if (url.pathname.endsWith('/music/folders'))
      return Response.json(
        url.search
          ? {
              schemaVersion: 1,
              indexes: {
                index: [
                  { name: 'S', artist: [{ id: 'folder', name: 'Nested folder', album: [] }] },
                ],
              },
            }
          : {
              schemaVersion: 1,
              folders: [
                { id: 'music', name: 'Studio collection' },
                { id: 'archive', name: 'Archive collection' },
              ],
            },
      );
    throw new Error('Unexpected fixture route');
  };
  render(<Router fetcher={fetcher} />);
  await user.type(await screen.findByLabelText('Username'), 'fixture');
  await user.type(screen.getByLabelText('Password'), 'fixture');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await user.click(await screen.findByRole('link', { name: 'Studio collection' }));
  await screen.findByRole('link', { name: 'Nested folder' });
  expect(window.location.search).toBe('?musicFolderId=music');
});

/** Undo restores an absent field exactly; it must not turn null into a dirty blank string. */
it('should restore the original absent value when undoing a field edit', async () => {
  const { MetadataEditor } = await editorModule();
  const fetcher = vi.fn<typeof fetch>();
  render(
    <MetadataEditor
      snapshot={{ ...snapshot, values: { ...snapshot.values, year: null } }}
      locale="en"
      client={createMetadataClient({ fetcher })}
      csrfToken="synthetic"
      apiOrigin=""
      canLyrics
      onSubmitted={vi.fn()}
      onClose={vi.fn()}
      onUnauthenticated={vi.fn()}
    />,
  );
  const year = screen.getByLabelText('Year');
  fireEvent.change(year, { target: { value: '2026' } });
  const section = year.closest('section')!;
  fireEvent.click(
    [...section.querySelectorAll('button')].find((button) => button.textContent === 'Undo change')!,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(await screen.findByText('No fields have changed.')).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});

/** Ambiguous front covers require an explicit target and local image URLs are always released. */
it('should reject unselected cover replacement and revoke its preview on close', async () => {
  const { MetadataEditor } = await editorModule();
  const create = vi.fn(() => 'blob:synthetic-cover');
  const revoke = vi.fn();
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  const fetcher = vi.fn<typeof fetch>();
  const view = render(
    <MetadataEditor
      snapshot={{
        ...snapshot,
        coverFrames: [
          {
            frameId: 'one',
            pictureType: 3,
            description: 'One',
            mimeType: 'image/png',
            previewUrl: '/api/v1/tracks/song/metadata/cover/one',
          },
          {
            frameId: 'two',
            pictureType: 3,
            description: 'Two',
            mimeType: 'image/png',
            previewUrl: '/api/v1/tracks/song/metadata/cover/two',
          },
        ],
      }}
      locale="en"
      client={createMetadataClient({ fetcher })}
      csrfToken="synthetic"
      apiOrigin=""
      canLyrics
      onSubmitted={vi.fn()}
      onClose={vi.fn()}
      onUnauthenticated={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('New JPEG or PNG image'), {
    target: { files: [new File(['synthetic'], 'cover.png', { type: 'image/png' })] },
  });
  expect(create).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
  expect(screen.getByText('Choose the front cover to change.')).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:synthetic-cover');
  vi.unstubAllGlobals();
});

/** Leaving a row menu for selection dismisses it without blocking the next action. */
it('should dismiss row options on outside activation and Escape while preserving editor entry', async () => {
  const { default: userEvent } = await import('@testing-library/user-event');
  const { MetadataAction } = await import('../src/metadata/components/MetadataAction');
  const { MetadataUIProvider } = await import('../src/metadata/MetadataUIProvider');
  const { MetadataSyncProvider } = await import('../src/metadata/MetadataSyncProvider');
  const user = userEvent.setup();
  const select = vi.fn();
  render(
    <MetadataSyncProvider
      scope="test"
      enabled={false}
      fetcher={async () => Response.json(snapshot)}
      apiOrigin=""
      onUnauthenticated={vi.fn()}
    >
      <MetadataUIProvider
        locale="en"
        base="/"
        apiOrigin=""
        csrfToken="synthetic"
        canEdit
        canLyrics
        canHistory
        onUnauthenticated={vi.fn()}
      >
        <MetadataAction song={{ id: 'song', title: 'Original title', isDir: false }} />
        <button onClick={select}>Select songs</button>
      </MetadataUIProvider>
    </MetadataSyncProvider>,
  );
  const trigger = screen.getByRole('button', { name: 'Music information: Original title' });
  await user.click(trigger);
  await screen.findByRole('button', { name: 'Edit music information' });
  await user.click(screen.getByRole('button', { name: 'Select songs' }));
  expect(select).toHaveBeenCalledOnce();
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: 'Edit music information' })).toBeNull();
  await user.click(trigger);
  (await screen.findByRole('button', { name: 'Edit music information' })).focus();
  await user.keyboard('{Escape}');
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
  await user.click(trigger);
  await user.click(await screen.findByRole('button', { name: 'Edit music information' }));
  expect(await screen.findByRole('dialog')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Edit music information' }),
  );
});
