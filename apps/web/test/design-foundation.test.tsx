// @vitest-environment jsdom
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MusicRow } from '../src/music/components/MusicRow';

afterEach(cleanup);
async function makeSUT(name: string): Promise<ComponentType<Record<string, unknown>>> {
  const path = resolve(`apps/web/src/design/components/${name}.tsx`);
  expect(existsSync(path), `${name} shared implementation`).toBe(true);
  return (await import(path))[name];
}
describe('design foundation', () => {
  /** Native keyboard activation works and busy/disabled actions cannot submit again. */
  it('should activate actions by keyboard and block duplicate busy actions', async () => {
    const Action = await makeSUT('Action');
    const user = userEvent.setup();
    let count = 0;
    const view = render(<Action onClick={() => count++}>Listen</Action>);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Listen' }));
    await user.keyboard('{Enter} ');
    expect(count).toBe(2);
    view.rerender(
      <Action busy onClick={() => count++}>
        Listen
      </Action>,
    );
    expect(screen.getByRole('button').getAttribute('aria-busy')).toBe('true');
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button'));
    expect(count).toBe(2);
    view.rerender(<Action disabled>Listen</Action>);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });
  /** Icon actions expose a stable accessible label and toggle state. */
  it('should name icon actions and expose pressed and disabled states', async () => {
    const IconAction = await makeSUT('IconAction');
    render(
      <IconAction label="Favorite" pressed disabled>
        <svg aria-hidden="true" />
      </IconAction>,
    );
    const button = screen.getByRole('button', { name: 'Favorite' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
  /** Field descriptions preserve caller help, error association and native form submit. */
  it('should associate labels help and errors without breaking keyboard input', async () => {
    const TextField = await makeSUT('TextField');
    const user = userEvent.setup();
    let submitted = false;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <p id="external">External help</p>
        <TextField
          label="Username"
          help="Your account"
          error="Enter a username"
          aria-describedby="external"
        />
        <button type="submit">Submit</button>
      </form>,
    );
    const field = screen.getByRole('textbox', { name: 'Username' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    const descriptions = field
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(descriptions).toEqual(['External help', 'Your account', 'Enter a username']);
    await user.type(field, 'latte{Enter}');
    expect(submitted).toBe(true);
    expect((field as HTMLInputElement).value).toBe('latte');
  });
  /** Disabled fields remain named and cannot receive typed input. */
  it('should preserve disabled field semantics', async () => {
    const TextField = await makeSUT('TextField');
    render(<TextField label="Unavailable" disabled />);
    expect(
      (screen.getByRole('textbox', { name: 'Unavailable' }) as HTMLInputElement).disabled,
    ).toBe(true);
  });
  /** Recovery actions are usable and loading/error announcements have distinct roles. */
  it('should announce scoped status and support recovery', async () => {
    const StatusSurface = await makeSUT('StatusSurface');
    let recovered = false;
    const view = render(
      <StatusSurface state="loading" title="Loading" description="Keep listening" />,
    );
    expect(screen.getByRole('status').textContent).toContain('Keep listening');
    view.rerender(
      <StatusSurface
        state="error"
        title="Could not load"
        description="Try again"
        action={<button onClick={() => (recovered = true)}>Retry</button>}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Could not load');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(recovered).toBe(true);
    view.rerender(<StatusSurface state="empty" title="No music" description="Choose a folder" />);
    expect(screen.getByRole('status').textContent).toContain('No music');
  });
  /** Artwork retains its frame through load/failure and retries when its source changes. */
  it('should keep artwork geometry and accessible fallback through image transitions', async () => {
    const Artwork = await makeSUT('Artwork');
    const view = render(<Artwork src="/cover-a.svg" alt="Night garden" />);
    const frame = screen.getByRole('img', { name: 'Night garden' });
    expect(frame.getAttribute('data-state')).toBe('loading');
    const image = view.container.querySelector('img')!;
    fireEvent.load(image);
    expect(frame.getAttribute('data-state')).toBe('available');
    fireEvent.error(image);
    expect(frame.getAttribute('data-state')).toBe('failure');
    expect(view.container.querySelector('img')).toBeNull();
    view.rerender(<Artwork src="/cover-b.svg" alt="Night garden" />);
    expect(screen.getByRole('img').getAttribute('data-state')).toBe('loading');
    view.rerender(<Artwork alt="Missing cover" />);
    expect(screen.getByRole('img').getAttribute('data-state')).toBe('missing');
    view.rerender(<Artwork alt="" />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(view.container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });
  /** A feature action slot remains inside its MusicRow occurrence without changing default rows. */
  it('should associate an optional action group with the rendered music row', () => {
    const view = render(
      <ul>
        <MusicRow
          song={{ id: 'song-a', title: 'First song', isDir: false }}
          locale="en"
          actions={<button aria-label="Edit First song">Edit</button>}
        />
      </ul>,
    );
    expect(screen.getByRole('button', { name: 'Edit First song' }).closest('li')).toBe(
      view.container.querySelector('li'),
    );
  });

  /** Multiple feature action groups stay aligned as one rail beside a music row. */
  it('should align music row action groups on one horizontal rail', () => {
    const css = readFileSync(resolve('apps/web/src/music/components/MusicRow.module.css'), 'utf8');
    const actionRail = css.match(/\.rowActions\s*\{([^}]*)\}/)?.[1];

    expect(actionRail).toContain('display: flex');
    expect(actionRail).toContain('align-items: center');
  });
});
