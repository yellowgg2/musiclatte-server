// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScanSettingsPanel } from '../src/pages/settings/ScanSettingsPanel';
afterEach(cleanup);
function makeSUT() {
  let settings = {
    schemaVersion: 1,
    enabled: false,
    intervalMinutes: 360,
    nextRunAt: null,
    lastStartedAt: null,
    lastError: null,
  };
  const calls: { path: string; init: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const path = String(input);
    calls.push({ path, init });
    if (path.endsWith('/schedule')) {
      if (init?.method === 'PUT') settings = { ...settings, ...JSON.parse(String(init.body)) };
      return Response.json(settings);
    }
    return Response.json(
      init?.method === 'POST'
        ? { schemaVersion: 1, accepted: true }
        : { schemaVersion: 1, scanning: false, count: 0 },
    );
  };
  const onUnauthenticated = vi.fn();
  render(
    <ScanSettingsPanel
      locale="en"
      fetcher={fetcher}
      apiOrigin=""
      csrfToken="synthetic"
      onUnauthenticated={onUnauthenticated}
      onRetryCapabilities={() => {}}
    />,
  );
  return { calls };
}
/** Saving is explicit, authenticated and independent from triggering an immediate scan. */
it('shows six-hour default, saves an enabled interval and starts a scan', async () => {
  const s = makeSUT();
  const field = await screen.findByRole('spinbutton', { name: 'Scan interval (minutes)' });
  expect((field as HTMLInputElement).value).toBe('360');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Automatic scanning' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
  await screen.findByText('Settings saved.');
  const saved = s.calls.find((c) => c.init?.method === 'PUT')!;
  expect(JSON.parse(String(saved.init?.body))).toEqual({ enabled: true, intervalMinutes: 360 });
  expect(new Headers(saved.init?.headers).get('X-CSRF-Token')).toBe('synthetic');
  fireEvent.click(screen.getByRole('button', { name: 'Scan now' }));
  await screen.findByText('Media scan requested.');
  expect(s.calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1);
});
/** Invalid and unsaved values never change the server schedule. */
it('rejects an interval shorter than fifteen minutes', async () => {
  const s = makeSUT();
  const field = await screen.findByRole('spinbutton');
  fireEvent.change(field, { target: { value: '1' } });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'Save settings' }) as HTMLButtonElement).disabled,
    ).toBe(true),
  );
  expect(s.calls.some((c) => c.init?.method === 'PUT')).toBe(false);
});
