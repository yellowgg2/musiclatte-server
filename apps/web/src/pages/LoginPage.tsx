import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SessionState } from '../auth/session-store';
import { Action } from '../design/components/Action';
import { TextField } from '../design/components/TextField';
import { StatusSurface } from '../design/components/StatusSurface';
import { messages, type Locale } from '../i18n';
import { LanguagePicker } from '../app/LanguagePicker';
import styles from '../app/Shell.module.css';
export function LoginPage({
  state,
  locale,
  onLocale,
  onLogin,
  base,
}: {
  base: string;
  state: SessionState;
  locale: Locale;
  onLocale: (locale: Locale) => void;
  onLogin: (username: string, password: string) => Promise<void>;
}) {
  const copy = messages[locale];
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.error) form.current?.querySelector<HTMLInputElement>('[name="password"]')?.focus();
  }, [state.error]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (state.busy) return;
    setSubmitted(true);
    if (!username || !password) {
      form.current
        ?.querySelector<HTMLInputElement>(!username ? '[name="username"]' : '[name="password"]')
        ?.focus();
      return;
    }
    const secret = password;
    setPassword('');
    await onLogin(username, secret);
  }
  return (
    <div className={styles.loginPage}>
      <header className={styles.loginHeader}>
        <span className={styles.brand}>
          <img
            src={`${base}icons/musiclatte-192.png`}
            width="32"
            height="32"
            alt=""
            className={styles.brandIcon}
          />
          Musiclatte
        </span>
        <LanguagePicker locale={locale} onChange={onLocale} />
      </header>
      <main id="main" className={styles.loginMain}>
        <div className={styles.loginCard}>
          <div className={styles.intro}>
            <img
              className={styles.emblem}
              src={`${base}icons/musiclatte-192.png`}
              width="64"
              height="64"
              alt=""
            />
            <h1>{copy['login.title']}</h1>
            <p>{copy['login.description']}</p>
          </div>
          {state.reason === 'expired' && (
            <p role="status" className={styles.notice}>
              {copy['login.expired']}
            </p>
          )}
          {state.error && (
            <StatusSurface
              state="error"
              title={copy['status.error']}
              description={copy[`error.${state.error}`]}
            />
          )}
          <form
            ref={form}
            noValidate
            onSubmit={(event) => {
              void submit(event);
            }}
            className={styles.form}
          >
            <TextField
              name="username"
              label={copy['login.username']}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={256}
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              {...(submitted && !username ? { error: copy['login.required'] } : {})}
            />
            <TextField
              name="password"
              label={copy['login.password']}
              type="password"
              autoComplete="current-password"
              maxLength={4096}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              {...(submitted && !password && !state.busy && !state.error
                ? { error: copy['login.required'] }
                : {})}
            />
            <Action type="submit" busy={state.busy}>
              {copy[state.busy ? 'login.busy' : 'login.submit']}
            </Action>
          </form>
        </div>
      </main>
    </div>
  );
}
