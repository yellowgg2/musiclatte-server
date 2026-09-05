import { useId, type InputHTMLAttributes } from 'react';
import styles from './TextField.module.css';
export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  help?: string;
  error?: string;
}
export function TextField({
  label,
  help,
  error,
  id,
  className,
  'aria-describedby': describedBy,
  ...props
}: TextFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const description = [describedBy, help && `${inputId}-help`, error && `${inputId}-error`]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={styles.field}>
      <label htmlFor={inputId} className={styles.label}>
        {label}
      </label>
      <input
        {...props}
        id={inputId}
        className={[styles.input, className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : props['aria-invalid']}
        aria-describedby={description || undefined}
      />
      {help && (
        <p id={`${inputId}-help`} className={styles.help}>
          {help}
        </p>
      )}
      {error && (
        <p id={`${inputId}-error`} className={styles.error}>
          {error}
        </p>
      )}
    </div>
  );
}
