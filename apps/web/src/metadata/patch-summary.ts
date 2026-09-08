import type { MetadataPatch } from '@musiclatte/contracts';
import { messages, type Locale } from '../i18n';
export function patchSummary(patch: MetadataPatch, locale: Locale) {
  const copy = messages[locale];
  return Object.entries(patch).map(([field, change]) => ({
    field,
    label: copy[`metadata.${field as keyof MetadataPatch}`],
    value:
      change.op === 'clear'
        ? copy['metadata.cleared']
        : 'value' in change
          ? Array.isArray(change.value)
            ? change.value.join(' · ')
            : change.value
          : 'text' in change
            ? change.text
            : copy['metadata.newPreview'],
  }));
}
