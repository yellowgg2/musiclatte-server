const transientMessages = ['database is locked', 'database_is_locked', 'SQLITE_BUSY'];

export function transientSqliteContention(value: unknown): boolean {
  const message = value instanceof Error ? value.message : typeof value === 'string' ? value : '';
  return transientMessages.some((candidate) => message.includes(candidate));
}
